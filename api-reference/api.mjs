import {createServer} from 'node:http';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {
  openStore,transact,passwordHash,matchesPassword,seal,unseal,
  token,digest,isToken,id,timestamp,maxDevices,version,deviceView
} from './store.mjs';
import {HttpError,normalizedEmail,password,name,parseDevice,parseLine} from './validation.mjs';

import {isMobile,mobileFilename,mobileProfile,iosSelectedProfileFilename,iosSelectedProfile} from './mobile.mjs';

const rules = JSON.parse(readFileSync(new URL('./rules.json',import.meta.url)));
const health = {state:'unknown',failures:0,since:null,changesLeft:0,lastChangedAt:null};
const accessDuration=15*60_000, refreshDuration=30*86400_000;
const trialDuration=86_400_000;
const routeId=/^[0-9a-f-]{36}$/;
const forbidden = (message='请先开通永久授权。') => new HttpError(403,'forbidden',message);
const unauthorized=()=>new HttpError(401,'unauthorized','请重新登录。');
const missing=()=>new HttpError(404,'not_found','功能或记录不存在。');
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function write(res,status,data,type='application/json; charset=utf-8') {
  res.writeHead(status,{
    'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'"
  });
  res.end(type.startsWith('application/') ? JSON.stringify(data) : data);
}

async function body(req,limit=65536) {
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>limit)throw new HttpError(413,'payload_too_large','数据太大。');
    chunks.push(chunk);
  }
  const data=Buffer.concat(chunks).toString('utf8');
  if(req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){
    return Object.fromEntries(new URLSearchParams(data));
  }
  if(!data)return {};
  try {
    const value=JSON.parse(data);
    if(value===null||typeof value!=='object'||Array.isArray(value))throw Error();
    return value;
  } catch {
    throw new HttpError(400,'invalid_request','请求格式无效。');
  }
}

function mailTransport() {
  const from = process.env.LEYRA_MAIL_FROM;
  if(!from || !/^[a-z0-9._%+@-]+$/i.test(from) || !from.includes('@'))return null;
  return ({email,subject,text})=>new Promise((resolve,reject)=>{
    const child = spawn('/usr/sbin/sendmail',['-t','-i'],{stdio:['pipe','ignore','ignore'],timeout:12_000});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(new Error('Mail relay failed')));
    child.stdin.once('error',reject);
    child.stdin.end([
      'From: '+from,'To: '+email,'Subject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=',
      'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64','',
      ...(Buffer.from(text).toString('base64').match(/.{1,76}/g)??[])
    ].join('\r\n')+'\r\n');
  });
}

export function createApi({db,key,origin,sendMail=null,trustProxy=false}) {
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('A 32-byte key is required');
  const base=new URL(origin);
  if(base.pathname!=='/'||base.search||base.hash||base.protocol!=='https:')throw Error('Public origin must be an HTTPS origin');
  const publicUrl=base.origin;
  const sql=(query,...params)=>db.prepare(query).get(...params);
  const all=(query,...params)=>db.prepare(query).all(...params);
  const execute=(query,...params)=>db.prepare(query).run(...params);
  const getUser=userId=>sql('SELECT * FROM users WHERE id=?',userId);
  const trialFor=user=>sql('SELECT ends_at FROM trials WHERE user_id=?',user.id)?.ends_at ?? null;
  const hasAccess=user=>!!user.lifetime_at || trialFor(user)>Date.now();
  const requireAccess=user=>{
    if(hasAccess(user))return;
    const expired=trialFor(user)!==null;
    throw forbidden(expired?'1 天试用已结束，请加 QQ 群 1136427075 购买 ¥199 永久授权。':undefined);
  };
  function requireMobileLicense(user, platform) {
    if(isMobile(platform)&&!user.lifetime_at)throw forbidden('添加手机需要永久授权，请加 QQ 群 1136427075。');
  }
  let hashPending=0;

  function rate(keyName,max,periodMs){
    const now=Date.now();
    const result=sql(`
      INSERT INTO rate_limit (key,hits,until) VALUES (?,1,?)
      ON CONFLICT (key) DO UPDATE SET hits=CASE WHEN until<=? THEN 1 ELSE hits+1 END,
        until=CASE WHEN until<=? THEN excluded.until ELSE until END
      RETURNING hits
    `,keyName,now+periodMs,now,now);
    if(result.hits>max)throw new HttpError(429,'rate_limited','操作太频繁，请稍后再试。');
  }

  async function hashWork(action){
    if(hashPending>=4)throw new HttpError(503,'busy','服务器繁忙，请稍后重试。');
    hashPending++;
    try{return await action();}finally{hashPending--;}
  }

  function issue(userId) {
    const accessToken=token(),refreshToken=token();
    const now=Date.now(),sessionId=id(), at=timestamp();
    execute('DELETE FROM sessions WHERE user_id=? AND refresh_exp<?',userId,now);
    execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)',sessionId,userId,digest(accessToken),digest(refreshToken),
      now+accessDuration,now+refreshDuration,at,at);
    return {accessToken,refreshToken,accessExpiresAt:new Date(now+accessDuration).toISOString()};
  }

  function authenticate(req) {
    const value=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!value)throw unauthorized();
    const session=sql('SELECT * FROM sessions WHERE access=? AND access_exp>?',digest(value),Date.now());
    if(!session)throw unauthorized();
    return {user:getUser(session.user_id),session};
  }

  async function mail(user,purpose) {
    if(!sendMail)throw new HttpError(503,'mail_unavailable','邮件服务还未开通，请联系 QQ 客服。');
    const raw=token(), hash=digest(raw);
    execute('INSERT INTO mail_tokens VALUES (?,?,?,?)',hash,user.id,purpose,Date.now()+(purpose==='verify'?86400_000:3600_000));
    try{
      const link=new URL('/account/'+purpose,publicUrl);
      link.searchParams.set('token',raw);
      await sendMail({
        email:user.email,subject:purpose==='verify'?'验证你的 Leyra 账号':'重置 Leyra 密码',
        text:'打开以下链接完成操作。若你没有发起请求，可以忽略此邮件。\n\n'+link.href
      });
    }catch{
      execute('DELETE FROM mail_tokens WHERE hash=?',hash);
      throw new HttpError(503,'mail_unavailable','暂时无法发送邮件，请稍后重试。');
    }
  }

  function webForm(res,purpose,raw) {
    if(!isToken(raw))throw missing();
    const heading=purpose==='verify'?'验证 Leyra 邮箱':'重置 Leyra 密码';
    const fields=purpose==='verify'?'':'<p><label>新密码 <input type="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password"></label></p>';
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+heading+
      '</title><link rel="stylesheet" href="/assets/site.css"><main class="wrap content"><h1>'+heading+'</h1><form method="post" action="/account/'+purpose+'"><input type="hidden" name="token" value="'+escape(raw)+'">'+fields+
      '<button type="submit">确认</button></form></main></html>';
    write(res,200,html,'text/html; charset=utf-8');
  }

  async function completeMail(res,purpose,input) {
    if(!isToken(input.token))throw missing();
    const hash=digest(input.token);
    const candidate=sql('SELECT * FROM mail_tokens WHERE hash=? AND purpose=? AND expires>?',hash,purpose,Date.now());
    if(!candidate)throw new HttpError(400,'invalid_request','链接已使用或过期，请重新申请。');
    const updated=purpose==='reset'?await hashWork(()=>passwordHash(password(input.password))):null;
    transact(db,()=>{
      const active=sql('DELETE FROM mail_tokens WHERE hash=? AND purpose=? AND expires>? RETURNING user_id',hash,purpose,Date.now());
      if(!active)throw new HttpError(400,'invalid_request','链接已使用或过期，请重新申请。');
      if(purpose==='verify'){
        const verified=execute('UPDATE users SET verified_at=? WHERE id=? AND verified_at IS NULL',timestamp(),active.user_id);
        if(verified.changes)execute('UPDATE trials SET ends_at=? WHERE user_id=? AND ends_at IS NULL',Date.now()+trialDuration,active.user_id);
      }
      else{
        execute('UPDATE users SET password=? WHERE id=?',updated,active.user_id);
        execute('DELETE FROM sessions WHERE user_id=?',active.user_id);
      }
      execute('DELETE FROM mail_tokens WHERE user_id=? AND purpose=?',active.user_id,purpose);
    });
    write(res,200,'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Leyra 账号 · 操作成功</title><link rel="stylesheet" href="/assets/site.css"><main class="wrap content"><h1>操作成功</h1><p>请返回 Leyra 客户端登录。</p><a class="button" href="/account/">查看账号说明</a></main>','text/html; charset=utf-8');
  }

  function lineFor(userId) {
    const row=sql('SELECT * FROM lines WHERE user_id=?',userId);
    return row?{...unseal(key,'line:'+userId,row.config),updatedAt:row.updated_at}:null;
  }
  function lineView(line){
    if(!line)return null;
    const {password:_discard,...record}=line;
    return record;
  }
  function assignment(line){
    return line?{status:'ready',region:null,ip:line.exitIp,assignedAt:line.updatedAt,source:'own'}:null;
  }
  function me(user){
    const line=lineFor(user.id);
    const trialEnd=trialFor(user);
    return {
      user:{id:user.id,email:user.email,emailVerified:!!user.verified_at,hasPassword:true,nickname:user.nickname,avatarUrl:null},
      subscription:user.lifetime_at?{
        status:'active',plan:'yearly',currentPeriodEnd:'9999-12-31T23:59:59.000Z',
        cancelAtPeriodEnd:false,channel:'wechat',product:'own',lifetime:true
      }:trialEnd!==null?{
        status:trialEnd>Date.now()?'active':'expired',plan:'yearly',product:'own',
        currentPeriodEnd:new Date(trialEnd).toISOString(),cancelAtPeriodEnd:false,toolTrial:true
      }:null,
      assignment:assignment(line), ownLine:lineView(line),
      devices:all('SELECT * FROM devices WHERE user_id=? ORDER BY created_at',user.id).map(deviceView),
      limits:{maxDevices},pendingOrderId:null,scriptVersion:version,
      ipHealth:health,staleScript:null,disclaimerAt:user.disclaimer_at,
      trial:{status:'none',endsAt:null,newIp:false}
    };
  }
  function deviceSecret(device){
    return createHmac('sha256',key).update('device:'+device.id+':'+device.token_version).digest('base64url');
  }
  function script(device){
    const ruleBase=publicUrl+'/v1/line/'+device.id+'/'+deviceSecret(device);
    if(isMobile(device.platform)) {
      return {device:deviceView(device),script:ruleBase+'/'+mobileFilename(device.platform),scriptVersion:version};
    }
    return {device:deviceView(device),script:'const AIN = {\n  ruleBase: '+JSON.stringify(ruleBase)+'\n};\n',scriptVersion:version};
  }

  const server=createServer(async(req,res)=>{
    let command;
    try{
      const url=new URL(req.url,publicUrl);
      if(url.origin!==publicUrl)throw missing();
      const pathname=url.pathname, method=req.method;
      command=method+' '+pathname;
      const proxyIp=trustProxy?req.headers['x-forwarded-for']?.split(',').at(-1)?.trim():null;
      const peer=proxyIp||req.socket.remoteAddress||'unknown';
      if(/^\/(?:v1\/auth\/|account\/)/.test(pathname))rate('ip:'+peer,90,60_000);
      if(command==='GET /healthz')return write(res,200,{ok:sql('SELECT 1 AS ok').ok===1,service:'leyra-api'});
      if(command==='GET /v1/auth/config')return write(res,200,{google:false});
      if(command==='GET /v1/plans')return write(res,200,{
        plans:[],channels:['wechat'],ownFree:false,ipForNew:false,referralOn:false,
        buyout:{priceCents:19900,left:0,limit:0,trialDays:1,maxDevices}
      });
      if(command==='GET /v1/notices')return write(res,200,{notices:[]});
      if(command==='GET /v1/changelog')return write(res,200,{entries:[]});
      if(command==='GET /v1/chat/status')return write(res,200,{online:false,replyHint:'购买与售后请加 QQ 群 1136427075'});
      const form=pathname.match(/^\/account\/(verify|reset)$/);
      if(form&&method==='GET')return webForm(res,form[1],url.searchParams.get('token'));
      if(form&&method==='POST')return await completeMail(res,form[1],await body(req));

      if(command==='POST /v1/auth/signup'){
        if(!sendMail)throw new HttpError(503,'mail_unavailable','注册邮件服务还未开通，请联系 QQ 客服。');
        const input=await body(req);
        const email=normalizedEmail(input.email),pass=password(input.password),nickname=name(input.nickname,true)||null;
        if(input.acceptTerms!==true)throw new HttpError(400,'invalid_request','请先阅读并同意服务条款。');
        rate('signup:'+peer,8,3600_000);
        rate('mail:'+digest(email),4,3600_000);
        const hash=await hashWork(()=>passwordHash(pass));
        const userId=id();
        const created=transact(db,()=>{
          const inserted=execute('INSERT OR IGNORE INTO users (id,email,password,nickname,created_at) VALUES (?,?,?,?,?)',
            userId,email,hash,nickname,timestamp());
          if(inserted.changes)execute('INSERT INTO trials (user_id) VALUES (?)',userId);
          return inserted.changes===1;
        });
        if(created)await mail(getUser(userId),'verify');
        return write(res,200,{});
      }
      if(command==='POST /v1/auth/login'){
        const input=await body(req);
        const email=normalizedEmail(input.email),pass=password(input.password,1);
        rate('login:'+peer,30,15*60_000);
        rate('login-email:'+digest(email),15,15*60_000);
        const user=sql('SELECT * FROM users WHERE email=?',email);
        if(!await hashWork(()=>matchesPassword(pass,user?.password)))throw new HttpError(401,'invalid_credentials','邮箱或密码不正确。');
        if(!user.verified_at)throw new HttpError(403,'email_not_verified','请先验证邮箱。');
        const current=getUser(user.id);
        if(!current||current.password!==user.password)throw unauthorized();
        return write(res,200,transact(db,()=>issue(user.id)));
      }
      if(command==='POST /v1/auth/refresh'){
        const {refreshToken}=await body(req);
        if(!isToken(refreshToken))throw unauthorized();
        const session=sql('SELECT * FROM sessions WHERE refresh=? AND refresh_exp>?',digest(refreshToken),Date.now());
        if(!session)throw unauthorized();
        const accessToken=token(),accessExp=Date.now()+accessDuration;
        execute('UPDATE sessions SET access=?,access_exp=?,used_at=? WHERE id=?',digest(accessToken),accessExp,timestamp(),session.id);
        return write(res,200,{accessToken,refreshToken,accessExpiresAt:new Date(accessExp).toISOString()});
      }
      if(command==='POST /v1/auth/resend'||command==='POST /v1/auth/forgot'){
        if(!sendMail)throw new HttpError(503,'mail_unavailable','邮件服务还未开通，请联系 QQ 客服。');
        const email=normalizedEmail((await body(req)).email);
        rate('mail:'+digest(email),4,3600_000);
        const user=sql('SELECT * FROM users WHERE email=?',email);
        if(user){
          if(command.endsWith('/resend')&&!user.verified_at)await mail(user,'verify');
          if(command.endsWith('/forgot')&&user.verified_at)await mail(user,'reset');
        }
        return write(res,200,{});
      }
      const config=pathname.match(/^\/v1\/line\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{43})\/([a-z0-9-]+\.(?:yaml|conf))$/);
      if(config&&method==='GET'){
        const [,deviceId,deviceToken,file]=config;
        const device=sql('SELECT * FROM devices WHERE id=?',deviceId);
        if(!device||!timingSafeEqual(Buffer.from(deviceToken),Buffer.from(deviceSecret(device))))throw missing();
        const user=getUser(device.user_id);
        if(isMobile(device.platform)){
          if(!user.lifetime_at)throw missing();
          const useSelectedNode=device.platform==='ios'&&file===iosSelectedProfileFilename;
          if(!useSelectedNode&&file!==mobileFilename(device.platform))throw missing();
          const line=lineFor(user.id);
          if(!line)throw missing();
          const {content,type}=useSelectedNode?iosSelectedProfile(rules):mobileProfile(device.platform,line,rules);
          return write(res,200,content,type);
        }
        if(!hasAccess(user))throw missing();
        if(file==='ip.yaml'){
          const line=lineFor(user.id);
          if(!line)throw missing();
          return write(res,200,{proxies:[{name:'Leyra 独享 IP',type:line.type,server:line.server,port:line.port,
            username:line.username,password:line.password,udp:false}]});
        }
        const name=file.slice(0,-5);
        if(!Object.hasOwn(rules,name))throw missing();
        return write(res,200,{payload:rules[name]});
      }

      if(command==='POST /v1/installs'||command==='POST /v1/installs/active')return write(res,200,{});
      if(command==='GET /')return write(res,200,{service:'leyra-api',health:'/healthz'});
      const {user,session}=authenticate(req);
      if(command==='GET /v1/me')return write(res,200,me(user));
      if(command==='GET /v1/ideas')return write(res,200,{ideas:[]});
      if(command==='GET /v1/chat/unread')return write(res,200,{unread:0});
      if(command==='POST /v1/auth/logout'){
        execute('DELETE FROM sessions WHERE id=?',session.id);
        return write(res,200,{});
      }
      if(command==='POST /v1/me/disclaimer'){
        execute('UPDATE users SET disclaimer_at=coalesce(disclaimer_at,?) WHERE id=?',timestamp(),user.id);
        return write(res,200,{});
      }
      if(command==='POST /v1/account/profile'){
        const nickname=name((await body(req)).nickname,true)||null;
        execute('UPDATE users SET nickname=? WHERE id=?',nickname,user.id);
        return write(res,200,{});
      }
      if(command==='GET /v1/devices'){
        return write(res,200,{devices:me(user).devices});
      }
      if(command==='POST /v1/checkout')throw forbidden('永久授权请加 QQ 群 1136427075 联系客服。');
      if(command==='POST /v1/trial')throw forbidden('新账号验证邮箱后自动开始 1 天试用。');
      if(command==='POST /v1/checks'||command==='POST /v1/connlog')return write(res,200,{});

      requireAccess(user);
      if(command==='POST /v1/own-line/test'){
        const input=await body(req);
        requireAccess(getUser(user.id));
        const line=parseLine(input,lineFor(user.id));
        return write(res,200,{code:'needs_client_check',message:'配置格式正确。可以仍然保存，连接后由客户端核对实际出口。',
          exitIp:null,country:null,ms:null});
      }
      if(command==='POST /v1/own-line'){
        const input=await body(req);
        const line=transact(db,()=>{
          requireAccess(getUser(user.id));
          const parsed=parseLine(input,lineFor(user.id)), at=timestamp();
          execute('INSERT INTO lines VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at',
            user.id,seal(key,'line:'+user.id,parsed),at);
          return {...parsed,updatedAt:at};
        });
        return write(res,200,{ownLine:lineView(line),assignment:assignment(line)});
      }
      if(command==='POST /v1/devices'){
        const attrs=parseDevice(await body(req));
        const row=transact(db,()=>{
          const currentUser=getUser(user.id);
          requireAccess(currentUser);
          requireMobileLicense(currentUser,attrs.platform);
          if(!lineFor(user.id))throw forbidden('请先配置自己的独享 IP。');
          if(sql('SELECT count(*) AS n FROM devices WHERE user_id=?',user.id).n>=maxDevices)throw forbidden('设备已达上限。请先移除旧设备。');
          return sql('INSERT INTO devices (id,user_id,name,client,platform,home_region,mode,created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *',
            id(),user.id,attrs.name,attrs.client,attrs.platform,attrs.region,attrs.mode,timestamp());
        });
        return write(res,200,script(row));
      }
      const devicePath=pathname.match(/^\/v1\/devices\/([^/]+)(\/script(?:\/refresh)?)?$/);
      if(devicePath&&routeId.test(devicePath[1])){
        const [,deviceId,kind]=devicePath;
        const device=sql('SELECT * FROM devices WHERE id=? AND user_id=?',deviceId,user.id);
        if(!device)throw missing();
        if(method==='DELETE'&&!kind){
          execute('DELETE FROM devices WHERE id=? AND user_id=?',deviceId,user.id);
          return write(res,200,{});
        }
        if(method==='PATCH'&&!kind){
          const renamed=name((await body(req)).name);
          const result=sql('UPDATE devices SET name=? WHERE id=? AND user_id=? RETURNING *',renamed,deviceId,user.id);
          if(!result)throw missing();
          return write(res,200,deviceView(result));
        }
        if(method==='POST'&&kind){
          const input=await body(req);
          const currentUser=getUser(user.id);
          requireAccess(currentUser);
          requireMobileLicense(currentUser,device.platform);
          const region=typeof input.homeRegion==='string'&&/^[a-z]{2}$/i.test(input.homeRegion)?input.homeRegion.toUpperCase():device.home_region;
          const mode=['ai-only','split'].includes(input.mode)?input.mode:device.mode;
          const result=sql('UPDATE devices SET home_region=?,mode=?,token_version=token_version+? WHERE id=? AND user_id=? RETURNING *',
            region,mode,kind==='/script'?1:0,deviceId,user.id);
          if(!result)throw missing();
          return write(res,200,script(result));
        }
      }
      throw missing();
    }catch(error){
      if(res.destroyed||res.headersSent)return;
      if(error instanceof HttpError)return write(res,error.status,{error:{code:error.code,message:error.message}});
      console.error('API request failed',req.method,error.name,error.code??'');
      return write(res,500,{error:{code:'internal',message:'服务器暂时无法处理请求。'}});
    }
  });
  server.requestTimeout=20_000;
  server.headersTimeout=10_000;
  server.keepAliveTimeout=5000;
  server.maxConnections=120;
  const cleanup=setInterval(()=>{
    for(const [table,field] of [['rate_limit','until'],['mail_tokens','expires'],['sessions','refresh_exp']]){
      try{execute('DELETE FROM '+table+' WHERE '+field+'<?',Date.now());}catch(error){console.error('cleanup failed',error.code);}
    }
  },3600_000).unref();
  server.once('close',()=>clearInterval(cleanup));
  return server;
}

if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]){
  const config={
    db:openStore(process.env.LEYRA_DB||'/var/lib/leyra-api/leyra.sqlite'),
    key:Buffer.from(process.env.LEYRA_KEY||'','hex'),
    origin:process.env.LEYRA_ORIGIN||'https://client-api.leyra.xin',
    sendMail:mailTransport(),trustProxy:process.env.LEYRA_TRUST_PROXY==='1'
  };
  createApi(config).listen(Number(process.env.LEYRA_PORT||9080),'127.0.0.1',()=>{
    console.log('Leyra API listening on loopback');
  });
}
