import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openStore,timestamp} from './store.mjs';
import {createApi} from './api.mjs';

test('register, verify, log in, grant lifetime, activate and revoke a Mac device', async t => {
  const db=openStore(':memory:');
  const mailbox=[];
  const service=createApi({db,key:randomBytes(32),origin:'https://client-api.leyra.xin',
    sendMail:async message=>mailbox.push(message)});
  await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    await new Promise(resolve=>service.close(resolve));
    db.close();
  });
  const base='http://127.0.0.1:'+service.address().port;
  const get=(path,accessToken)=>fetch(base+path,{headers:accessToken?{authorization:'Bearer '+accessToken}:{}});
  const post=(path,input,accessToken,method='POST')=>fetch(base+path,{
    method,headers:{'content-type':'application/json',...accessToken?{authorization:'Bearer '+accessToken}:{}},
    body:JSON.stringify(input)
  });
  const parse=async res=>{assert.equal(res.status,200);return res.json();};
  const email='test@example.org', password='local-test-password';
  assert.deepEqual(await parse(await get('/v1/auth/config')),{google:false});
  const plan=(await parse(await get('/v1/plans'))).buyout;
  assert.equal(plan.priceCents,19900);
  assert.equal(plan.trialDays,1);
  await parse(await post('/v1/auth/signup',{email,password,acceptTerms:true}));
  assert.equal(mailbox.length,1);
  assert.equal(db.prepare('SELECT ends_at FROM trials').get().ends_at,null);
  assert.equal((await post('/v1/auth/login',{email,password})).status,403);
  const verify=new URL(mailbox[0].text.match(/https:\/\/[^\s]+/)[0]);
  assert.equal((await get(verify.pathname+verify.search)).status,200);
  assert.equal((await post('/v1/auth/login',{email,password})).status,403);
  const verifiedAfter=Date.now();
  assert.equal((await post(verify.pathname,{token:verify.searchParams.get('token')})).status,200);
  const trialEnd=db.prepare('SELECT ends_at FROM trials').get().ends_at;
  assert(trialEnd>=verifiedAfter+86_400_000 && trialEnd<=Date.now()+86_400_000);
  assert.equal((await post(verify.pathname,{token:verify.searchParams.get('token')})).status,400);
  const issued=await parse(await post('/v1/auth/login',{email,password}));
  const session=await parse(await post('/v1/auth/refresh',{refreshToken:issued.refreshToken}));
  assert.equal((await get('/v1/me',issued.accessToken)).status,401);
  const access=session.accessToken;
  const account=await parse(await get('/v1/me',access));
  assert.equal(account.subscription.toolTrial,true);
  assert.equal(account.subscription.status,'active');
  assert.equal(Date.parse(account.subscription.currentPeriodEnd),trialEnd);
  assert.equal(account.disclaimerAt,null);
  const device={name:'测试 Mac',platform:'macos',client:'clash-verge-rev',homeRegion:'US'};
  assert.equal((await post('/v1/devices',device,access)).status,403);
  await parse(await post('/v1/me/disclaimer',{},access));
  const line={type:'socks5',server:'gateway.example.org',port:1080,username:'customer',password:'proxy-password',exitIp:'203.0.113.25'};
  const configured=await parse(await post('/v1/own-line',line,access));
  assert.equal(configured.assignment.ip,line.exitIp);
  assert.equal(configured.ownLine.password,undefined);
  assert(!db.prepare('SELECT config FROM lines').get().config.includes(line.password));
  assert.equal((await parse(await get('/v1/me',access))).subscription.toolTrial,true);
  const phone={name:'测试手机',platform:'ios',client:'shadowrocket',homeRegion:'US'};
  assert.equal((await post('/v1/devices',phone,access)).status,403);
  assert.equal((await post('/v1/devices',{...phone,client:'clash-meta-android'},access)).status,400);
  const activated=await parse(await post('/v1/devices',device,access));
  const rule=new URL(activated.script.match(/ruleBase:\s*"([^"]+)"/)[1]);
  assert.equal((await parse(await get(rule.pathname+'/ip.yaml'))).proxies[0].password,line.password);
  assert((await parse(await get(rule.pathname+'/claude-core.yaml'))).payload.length>0);
  const renewed=await parse(await post('/v1/devices/'+activated.device.id+'/script',{},access));
  assert.notEqual(renewed.script,activated.script);
  assert.equal((await get(rule.pathname+'/ip.yaml')).status,404);
  const renewedRule=new URL(renewed.script.match(/ruleBase:\s*"([^"]+)"/)[1]);
  db.prepare('UPDATE trials SET ends_at=? WHERE user_id=?').run(Date.now()-1,account.user.id);
  assert.equal((await parse(await get('/v1/me',access))).subscription.status,'expired');
  assert.equal((await get(renewedRule.pathname+'/ip.yaml')).status,404);
  assert.equal((await get(renewedRule.pathname+'/claude-core.yaml')).status,404);
  const rejected=await post('/v1/own-line',line,access);
  assert.equal(rejected.status,403);
  assert.match((await rejected.json()).error.message,/1136427075/);
  db.prepare('UPDATE users SET lifetime_at=? WHERE id=?').run(timestamp(),account.user.id);
  assert.equal((await parse(await get('/v1/me',access))).subscription.lifetime,true);
  assert.equal((await get(renewedRule.pathname+'/ip.yaml')).status,200);
  const iphone=await parse(await post('/v1/devices',phone,access));
  const android=await parse(await post('/v1/devices',{...phone,platform:'android',client:'clash-meta-android'},access));
  const iphonePath=new URL(iphone.script).pathname;
  const androidPath=new URL(android.script).pathname;
  const iphoneConfig=await get(iphonePath);
  assert.equal(iphoneConfig.status,200);
  assert.match(await iphoneConfig.text(),/\[Proxy\][\s\S]+DOMAIN-SUFFIX,claude\.ai,Leyra[\s\S]+FINAL,DIRECT/);
  assert.equal(iphoneConfig.headers.get('Cache-Control'),'no-store');
  const selectedPath=iphonePath.replace(/leyra.conf$/,'leyra-selected.conf');
  const selectedConfig=await get(selectedPath);
  assert.equal(selectedConfig.status,200);
  assert.equal(selectedConfig.headers.get('Cache-Control'),'no-store');
  const selectedText=await selectedConfig.text();
  assert.match(selectedText,/DOMAIN-SUFFIX,claude\.ai,PROXY[\s\S]+FINAL,DIRECT/);
  assert(!selectedText.includes('[Proxy]')&&!selectedText.includes(line.password));
  assert.equal((await get(androidPath.replace(/leyra.yaml$/,'leyra-selected.conf'))).status,404);
  const androidConfig=await get(androidPath);
  assert.match(androidConfig.headers.get('Content-Type'),/^text\/yaml/);
  const androidData=JSON.parse(await androidConfig.text());
  assert.equal(androidData.proxies[0].server,line.server);
  assert.equal(androidData.proxies[0].password,line.password);
  assert(androidData.rules.includes('DOMAIN-SUFFIX,claude.ai,Leyra'));
  assert.equal(androidData.rules.at(-1),'MATCH,DIRECT');
  assert.equal((await get(androidPath.replace(/leyra.yaml$/,'ip.yaml'))).status,404);
  assert.equal((await get(new URL(iphone.script.replace(/leyra.conf$/,'leyra.yaml')).pathname)).status,404);
  const rotated=await parse(await post('/v1/devices/'+iphone.device.id+'/script',{},access));
  assert.equal((await get(iphonePath)).status,404);
  assert.equal((await get(selectedPath)).status,404);
  assert.equal((await get(new URL(rotated.script).pathname)).status,200);
  assert.equal((await post('/v1/devices/'+android.device.id,{},access,'DELETE')).status,200);
  assert.equal((await get(androidPath)).status,404);
  db.prepare('UPDATE users SET lifetime_at=NULL WHERE id=?').run(account.user.id);
  assert.equal((await get(new URL(rotated.script).pathname)).status,404);
  db.prepare('UPDATE users SET lifetime_at=? WHERE id=?').run(timestamp(),account.user.id);

  await parse(await post('/v1/auth/forgot',{email}));
  const reset=new URL(mailbox[1].text.match(/https:\/\/[^\s]+/)[0]);
  assert.equal((await post(reset.pathname,{token:reset.searchParams.get('token'),password:'replacement-password'})).status,200);
  assert.equal((await get('/v1/me',access)).status,401);
  assert.equal((await post('/v1/auth/login',{email,password})).status,401);
});

test('mail transport is required before self-serve registration can create an account', async t=>{
  const db=openStore(':memory:');
  const api=createApi({db,key:randomBytes(32),origin:'https://client-api.leyra.xin'});
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>api.close(resolve));db.close();});
  const result=await fetch('http://127.0.0.1:'+api.address().port+'/v1/auth/signup',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:'no-email@example.org',password:'test-password',acceptTerms:true})
  });
  assert.equal(result.status,503);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,0);
});
