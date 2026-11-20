function leyraInstallGuard(config,options){
  const entries=leyraExit.routes(leyraVlessProfile(),m.account?.ip,Se);
  const context=leyraExit.addProbeAndGate(config,entries,options.secret);
  const probeRules=context.entries.length?config.rules.splice(0,context.entries.length+1):[];
  leyraRouting.apply(config,options,context.gate,context.gate);
  config.rules.unshift(...probeRules);
  leyraExit.routeProtected(config,context.gate,Ot,Se);
  leyraGuard?.stop();
  let incidentShown=false;
  const runtime=new leyraExit.Guard(context,{
    probe:line=>leyraExit.readProbe(context,line),
    gate:out=>T.setExitGate(context.gate,out),
    drain:()=>T.drainExit(context.gate),
    saveChoice:id=>{
      const prior=leyraExit.load(leyraVlessProfile());
      leyraExit.save(leyraVlessProfile(),{...prior,preferred:id});
    },
    update:state=>{
      if(leyraGuard!==runtime)return;
      const previous=m.leyraExit;
      m.leyraExit=state;
      const picked=context.entries.find(entry=>entry.id===(state.activeId??state.selectedId));
      leyraVlessInUse=picked?.proxy?{id:picked.id,expectedIp:picked.expected}:null;
      if(m.aiCheck?.state==="done"){
        const check=state.entries.find(item=>item.id===(state.activeId??state.selectedId));
        m.aiCheck={...m.aiCheck,sites:check?[{name:"Claude",ip:check.actual??null,ms:check.ms,
          ok:state.phase==="verified"?true:check.state==="mismatch"?false:void 0}]:[]};
      }
      if(state.phase==="verified")incidentShown=false;
      if(!incidentShown&&state.phase==="blocked"&&!["checking","manual"].includes(state.reason)){
        incidentShown=true;
        j("拦截 Claude",leyraExitReason(state.reason));
        _e("Claude 已暂停",leyraExitReason(state.reason)+"。请打开 Leyra 查看恢复状态。");
      }
      if(previous?.phase==="blocked"&&!previous.entries.some(line=>line.state==="ready"&&line.id!==previous.selectedId)&&
        state.phase==="blocked"&&state.entries.some(line=>line.state==="ready"&&line.id!==state.selectedId)){
        j("线路提示","有备用线路通过核验，可在首页查看。");
      }
      V();
    },
    verified:(line,result)=>{
      j("出口核对","Claude 看到 "+result.actual);
      if(m.leyraExit?.phase==="blocked"&&line.id!==runtime.selected.id){
        j("线路恢复","已切换到备用入口，独享 IP 未变。");
      } else j("线路恢复","独享出口核验通过，Claude 已恢复。");
    },
    error:error=>{
      if(leyraGuard!==runtime||runtime.stopped)return;
      runtime.stop();
      m.leyraExit={...runtime.state(),phase:"blocked",reason:"controller"};
      j("拦截 Claude","无法确认内核已拦截，启动系统防直连保护。");
      V();
      void (async()=>{
        await ju("Claude 保护控制器异常").catch(()=>{});
        await Ir(false).catch(()=>{});
      })();
    }
  });
  leyraGuard=runtime;
  m.leyraExit=runtime.state();
  leyraVlessInUse=context.preferred?.proxy?{id:context.preferred.id,expectedIp:context.preferred.expected}:null;
}
function leyraExitReason(reason) {
  return {timeout:"上游连接超时",unreachable:"上游线路不通",http:"Claude 检测页未通过",tls:"安全连接失败",
    mismatch:"实际出口 IP 与登记值不一致",response:"无法读取真实出口 IP","no-route":"没有已登记的独享线路",
    controller:"网络组件无法确认拦截",checking:"等待出口核验",manual:"正在切换线路"}[reason]??"出口尚未核验";
}
let leyraVlessProbePending=null;
async function leyraDetectVless(id) {
  if(leyraVlessProbePending)throw Error("正在检测另一条节点，请稍候。");
  const profile=leyraVlessProfile();
  const accountId=m.account?.id;
  const node=leyraVlessTools.find(profile,id);
  const binary=require("node:path").join(process.resourcesPath,process.platform==="win32"?"mihomo.exe":"mihomo");
  const {probeVless}=require("./detect-vless-exit.cjs");
  const pending=probeVless(binary,node);
  leyraVlessProbePending=pending;
  try {
    const result=await pending;
    if(accountId!==m.account?.id||profile!==leyraVlessProfile())throw Error("账号已切换，请重新检测。");
    if(!result.ip)return {detected:false,message:leyraExitReason(result.error)+"。节点已保留，可以稍后重新检测。"};
    leyraExit.register(profile,id,result.ip);
    const hasRoute=async()=>{
      const context=leyraGuard?.context;
      const line=context?.entries.find(item=>item.id===id);
      return T.running&&m.conn.status==="connected"&&!!line&&
        await T.hasExitRoute(context.gate,line.out).catch(()=>false);
    };
    if(await hasRoute())return {detected:true,loaded:true,ip:result.ip};
    // Use the existing in-place TUN reconfiguration path. Disconnected and local-proxy modes load on the next normal connection.
    if(!Nt&&T.running&&m.conn.mode==="tun"&&m.conn.status==="connected"&&!YS()){
      const refresh=Eu();
      Nt=refresh;
      try {await refresh;}catch{}
      finally {if(Nt===refresh)Nt=null;}
    }
    return {detected:true,loaded:await hasRoute(),ip:result.ip};
  } catch(error) {
    return {detected:false,message:error.message||"出口检测失败。"};
  } finally {
    if(leyraVlessProbePending===pending)leyraVlessProbePending=null;
  }
}
x.ipcMain.handle("claudeExit.detect",(_,id)=>leyraDetectVless(id));
x.ipcMain.handle("claudeExit.inspect",()=>leyraGuard?.inspect());
x.ipcMain.handle("claudeExit.choose",(_,id,from,to)=>{
  if(YS()||!T.running||m.conn.status!=="connected"||!leyraGuard)throw Error("请先连接 Leyra。");
  return leyraGuard.choose(id,from,to);
});
