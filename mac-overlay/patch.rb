require 'json'
require 'fileutils'

def edit(code, anchor, replacement)
  raise "Missing or repeated anchor: #{anchor}" unless code.scan(anchor).length == 1
  code.sub!(anchor){replacement}
end

root=ARGV.fetch(0)
main=File.join(root,'dist/main')
file=File.join(main,'index.cjs')
code=File.read(file)
edit(code,'leyraVlessInUse=null,leyraVlessRetry=null;const',
  'leyraVlessInUse=null,leyraVlessRetry=null,leyraGuard=null;const leyraExit=require("./claude-exit-guard.cjs"),')
edit(code,'leyraRouting.apply(i,e,Ot,Se),leyraVlessInUse=leyraVless.read(leyraVlessProfile()),leyraVless.apply(i,leyraVlessInUse,Ot,Se),i}',
  'leyraInstallGuard(i,e),i}')
start=code.index('async setGate(t){')
finish=code.index('async connections(){',start)
raise 'Missing core gate' unless start&&finish
code[start...finish]=<<~'JS'
  async setExitGate(group,out){
    const response=await this.#t("/proxies/"+encodeURIComponent(group),{
      method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({name:out??"REJECT"})
    });
    if(!response.ok)throw Error("Claude 核验保护切换失败："+response.status);
    const check=await this.#t("/proxies/"+encodeURIComponent(group));
    if(!check.ok||(await check.json()).now!==(out??"REJECT"))throw Error("Claude 核验保护未生效");
  }
  async hasExitRoute(group,out){
    const response=await this.#t("/proxies/"+encodeURIComponent(group));
    return response.ok&&(await response.json()).all?.includes(out)===true;
  }
  async drainExit(group){
    await leyraExit.drainGroup(await this.connections(),group,async id=>{
      const response=await this.#t("/connections/"+encodeURIComponent(id),{method:"DELETE"});
      if(!response.ok&&response.status!==404)throw Error("无法关闭旧 Claude 连接");
    });
  }
  async setGate(t,sharedOnly=false){
    if(!t&&!sharedOnly&&leyraGuard){
      const current=leyraGuard;
      if(current.stopped){
        await current.writeGate(null);
        await this.drainExit(current.context.gate);
      }else await current.revoke();
    }
    let r=await this.#t("/proxies/"+encodeURIComponent(Ot),{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({name:t?Se:"REJECT"})});
    if(!r.ok)throw Error("AI 线路切换失败："+r.status);
  }
JS
edit(code,'f=u.block,p=u.warn;', 'f=leyraGuard?u.block.filter(item=>!item.startsWith("独享 · 静态 ISP 代理 IP")):u.block,p=u.warn;')
start=code.index('YS()&&await leyraExpireTrial();if(YS())return;await T.setGate(!0)')
finish=code.index('m.claudeSeen=Wu(Mn.all()),V(),void leyraClock().trySync()',start)
raise 'Missing prior exit verifier' unless start&&finish
code[start...finish]=<<~'JS'
  YS()&&await leyraExpireTrial();
  if(YS()||t())return;
  if(o===m.account?.ip&&o)await T.setGate(true);
  else await T.setGate(false,true);
  const verifier=leyraGuard;
  if(YS()||t()){await T.setGate(false).catch(()=>{});return}
  xu=false;
  m.aiCheck={state:"done",reason:null,sites:m.aiCheck?.sites??[],warn:p.length?p.join("、"):null};
  V();
  if(verifier)await verifier.permit().catch(verifier.io.error);
JS
edit(code,'})().finally(()=>{Xt=null}),Xt)}s(Te,"runChecks")',
  '})().finally(()=>{Xt=null;if(T.running&&m.conn.status==="connected"&&m.aiCheck?.state==="waiting"&&leyraGuard&&!leyraGuard.allowed&&!leyraGuard.stopped)setTimeout(()=>{void Te()},250).unref?.()}),Xt)}s(Te,"runChecks")')
edit(code,'x.app.whenReady().then(async()=>{XS(),', 'x.app.whenReady().then(async()=>{if(ge){const icon=x.nativeImage.createFromPath(Ly());if(!icon.isEmpty())x.app.dock?.setIcon(icon)}XS(),')
edit(code,'function tI(){Sr(),CT()', 'function tI(){Sr(true),CT()')
edit(code,'function Sr(){clearTimeout(leyraVlessRetry)',
  'function Sr(keepExit=false){if(!keepExit)leyraGuard?.stop();clearTimeout(leyraVlessRetry)')
edit(code,'e.includes(leyraVless.group)?{route:"ip",node:null}',
  'e.includes(leyraVless.group)||e.some(leyraExit.isGate)?{route:"ip",node:null}')
edit(code,'e.group===leyraVless.group)&&e.node==="REJECT"',
  'e.group===leyraVless.group||leyraExit.isGate(e.group))&&e.node==="REJECT"')
edit(code,'e.group!==Se&&(e.group!==leyraVless.group', 'e.group!==Se&&!leyraExit.isGate(e.group)&&(e.group!==leyraVless.group')
edit(code,'T.connections().then(e=>{if(vlessRuntime===leyraVlessInUse)', 'T.connections().then(connections=>{const e=connections.filter(item=>!leyraExit.isAuthenticatedProbeConnection(item));if(vlessRuntime===leyraVlessInUse)')
edit(code,'T.onLine=e=>{Vn.feed(e,pT()),Oy.feed(e)}',
  'T.onLine=e=>{if(leyraExit.isAuthenticatedProbeLog(e))return;Vn.feed(e,pT()),Oy.feed(e);const guard=leyraGuard;if(guard?.active&&nP(e)?.group===guard.context.gate)void guard.fail("unreachable").catch(guard.io.error)}')
edit(code,'rt&&Ru(),setTimeout(()=>{Te()},5e3)',
  'rt&&Ru(),void leyraRecheckExit()')
edit(code,'setTimeout(()=>{Te()},3e3)))},15e3)}s(CT,',
  'void leyraRecheckExit()))},2e3)}s(CT,')
edit(code,'function leyraVlessProfile() {',
  File.read(File.join(__dir__,'guard-main.cjs'))+<<~'JS')
    async function leyraRecheckExit(){
      const guard=leyraGuard;
      if(guard)await guard.revoke().catch(guard.io.error);
      if(Xt)await Xt.catch(()=>{});
      await Te().catch(error=>guard?.io.error(error));
    }
    function leyraVlessProfile() {
JS
edit(code,'  return leyraVlessTools.summary(leyraVlessProfile(),T.running?leyraVlessInUse:null);',<<~'JS'.rstrip)
  const profile=leyraVlessProfile();
  const state=leyraVlessTools.summary(profile,T.running?leyraVlessInUse:null);
  const measured=leyraExit.load(profile).ips;
  return {...state,nodes:state.nodes.map(node=>({...node,expectedIp:measured[node.id]??node.expectedIp}))};
JS
File.write(file,code)

file=File.join(main,'leyra-claude-vless.cjs')
code=File.read(file)
edit(code,"  if (!setting) return null\n  const {server", "  return setting ? fromSetting(setting) : null\n}\n\nfunction fromSetting(setting) {\n  const {server")
edit(code,'  const {server, port, uuid, servername, publicKey, shortId, expectedIp} = setting',<<~'JS'.rstrip)
    if(!isIP(setting.expectedIp))throw Error('Claude VLESS 出口配置无效')
    return {id:setting.id,expectedIp:setting.expectedIp,proxy:makeProxy(setting)}
  }

  function makeProxy(setting) {
    const {server, port, uuid, servername, publicKey, shortId} = setting
JS
edit(code,' || !isIP(expectedIp)) {', ') {')
edit(code,"  return {id:setting.id,expectedIp,proxy: {", '  return {')
edit(code,"'short-id': shortId}\n  }}".gsub('\n',"\n"), "'short-id': shortId}\n  }".gsub('\n',"\n"))
edit(code,'module.exports = {read, apply, group, node}', 'module.exports = {read, fromSetting, makeProxy, apply, group, node}')
File.write(file,code)
file=File.join(main,'vless-tools.cjs')
code=File.read(file)
edit(code,"connection.chains?.includes('Claude VLESS')","connection.chains?.some(name=>name==='Claude VLESS'||name==='Claude VLESS '+runtime.id)")
File.write(file,code)
%w[claude-exit-guard.cjs detect-vless-exit.cjs].each{|name| FileUtils.cp(File.join(__dir__,name),main)}

preload=File.join(root,'dist/preload/index.cjs')
code=File.read(preload)
edit(code,'vlessState:', 'claudeExitInspect:()=>i.ipcRenderer.invoke("claudeExit.inspect"),claudeExitDetect:id=>i.ipcRenderer.invoke("claudeExit.detect",id),claudeExitChoose:(...args)=>i.ipcRenderer.invoke("claudeExit.choose",...args),vlessState:')
File.write(preload,code)

renderer=Dir.glob(File.join(root,'dist/renderer/assets/index-*.js')).fetch(0)
code=File.read(renderer)
edit(code,'function LeyraVlessEntry(', File.read(File.join(__dir__,'guard-ui.js'))+"\nfunction LeyraVlessEntry(")
edit(code,'a=t.exitIp&&e.account?.ip?t.exitIp===e.account.ip:null,o=r&&t.lineUp===!1,s=r&&!!t.rechecking',
  'accountProbe=e.leyraExit?.entries.find(line=>line.id==="account"),accountSiteIp=accountProbe?.actual??t.exitIp,a=accountProbe?.state?accountProbe.state==="ready":t.exitIp&&e.account?.ip?t.exitIp===e.account.ip:null,o=r&&(accountProbe?.state?accountProbe.state==="failed":t.lineUp===!1),s=r&&!accountProbe?.state&&!!t.rechecking')
edit(code,'[t.exitIp?`出口 IP 是 ${t.exitIp}`:``,t.lineMs?', '[accountSiteIp?`出口 IP 是 ${accountSiteIp}`:``,t.lineMs?')
edit(code,'st:s(!n.exitIp||!o?.ip?`busy`:n.exitIp===o.ip?`ok`:`fail`)',
  'st:s(e.leyraExit?.entries.some(line=>line.id==="account"&&line.state==="ready")?`ok`:!n.exitIp||!o?.ip?`busy`:n.exitIp===o.ip?`ok`:`fail`)')
edit(code,'s=claudeSite?.ip??(o&&!e.claudeExpectedExitIp?i.exitIp:null)', 's=e.leyraExit?(e.leyraExit.phase==="verified"?claudeSite?.ip??null:null):claudeSite?.ip??(o&&!e.claudeExpectedExitIp?i.exitIp:null)')
edit(code,'(0,H.jsx)(uf,{state:e,nav:t}),o]', 'H.jsx(LeyraExitStatus,{state:e}),(0,H.jsx)(uf,{state:e,nav:t}),o]')
start=code.index('if(r.status===`connected`){if(r.local?.down)')
finish=code.index('let o=e.aiCheck;',start)
raise 'Missing main connection status' unless start&&finish
code.insert(finish,'}')
code.insert(start+'if(r.status===`connected`){'.length,'if(!e.leyraExit){')
edit(code,'if(e.claudeExpectedExitIp){'+"\n  "+'const probe=o.sites.find',
  'if(e.leyraExit&&e.leyraExit.phase!=="verified")return{tone:e.leyraExit.reason==="checking"?"amber":"red",icon:"shieldAlert",title:"Claude 暂停 · 等待核验",line1:"保留当前独享 IP，普通网络可继续使用。",line2:"",action:{label:"断开连接",kind:"disconnect",style:"secondary"},services:Ol("等待出口核对","amber")};'+
  "\n"+'  if(e.claudeExpectedExitIp){'+"\n  "+'const probe=o.sites.find')
start=code.index('  function activate(){')
finish=code.index('  function generate(){',start)
raise 'Missing VLESS controls' unless start&&finish
code[start...finish]=<<~'JS'
  async function detectExit(nodeId){
    setNote("正在通过新节点核验出口 IP…");
    const result=await u.claudeExitDetect(nodeId);
    setData(await u.vlessState());
    if(!result.detected){setNote("");setError(result.message);return}
    setNote(result.loaded?"已核验并加入备用线路。关闭此窗口，在首页「切换线路」里选用。":"已核验并登记。下次连接 Leyra 后，在首页「切换线路」里选用。");
  }

  function retryExit(){
    void action(()=>detectExit(node.id));
  }

JS
edit(code,'      setNote("已导入。");','      await detectExit(result.id);')
start=code.index('        H.jsxs("label",{className:"lab",children:["Mac Claude 独享出口 IP"')
finish=code.index("\n      ]}),",start)
raise 'Missing VLESS exit form' unless start&&finish
code[start...finish]=<<~'JS'.rstrip
        H.jsxs("div",{className:"lab",children:["Mac Claude 出口 IP",
          H.jsx("strong",{children:node.expectedIp||"待自动核验"})]}),
        H.jsx("button",{type:"button",className:"v1-btn soft",disabled:busy,onClick:retryExit,children:"重新检测出口"})
JS
edit(code,'  const [ip,setIp]=l.useState(null);'+"\n",'')
edit(code,'  const requestedIp=(ip??node?.expectedIp??"").trim();'+"\n",'')
edit(code,'setId(value);setIp(null);setQr(null);setNote("");','setId(value);setQr(null);setNote("");')
start=code.index('function wd(e,t,n=Date.now(),r=!1)')
finish=code.index('function Ed(hours,blocked)',start)
raise 'Missing 24-hour view' unless start&&finish
code[start...finish]=File.read(File.join(__dir__,'timeline.js'))
edit(code,'wd(e.log,e.conn.status===`connected`,Date.now(),t)', 'wd(e.log,e.conn.status===`connected`,Date.now(),t,e.leyraExit)')
edit(code,'现在正在拦截 Claude，复查通过后会自动恢复。','现在正在拦截 Claude。原独享 IP 核验通过后自动恢复。')
edit(code,'wd(e.log,n,Date.now(),r)', 'wd(e.log,n,Date.now(),r,e.leyraExit)')
edit(code,'children:`已连接`]}),(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`i`,{className:`none`}),`没连接`',
  'children:`已连接`]}),(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`i`,{className:`none`}),`未连接或未核验`') if code.include?('children:`已连接`]}),(0,H.jsxs)(`span`,{children:[(0,H.jsx)(`i`,{className:`none`}),`没连接`')
edit(code,'(0,H.jsx)(`i`,{className:`ok`}),`已连接`','(0,H.jsx)(`i`,{className:`ok`}),`出口核验通过`')
edit(code,'(0,H.jsx)(`i`,{className:`none`}),`没连接`','(0,H.jsx)(`i`,{className:`none`}),`未连接或未核验`')
edit(code,'title:Td(e,vl),style:e.st===`mixed`?{background:`linear-gradient(to top, #e5484d ${cf(e)}%, #22b573 ${cf(e)}%)`}:void 0',
  'title:Td(e,vl)')
File.write(renderer,code)
css=Dir.glob(File.join(root,'dist/renderer/assets/index-*.css')).fetch(0)
File.open(css,'a'){|f|f.write(File.read(File.join(__dir__,'guard.css')))}

FileUtils.cp(File.join(__dir__,'icon.png'),File.join(root,'build/icon.png'))
pkg=File.join(root,'package.json')
meta=JSON.parse(File.read(pkg))
raise 'Expected baseline 1.1.5' unless meta['version']=='1.1.5'
meta['version']='1.1.7'
File.write(pkg,JSON.pretty_generate(meta)+"\n")
