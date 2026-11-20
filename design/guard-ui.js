function LeyraExitStatus({state}){
  const [expanded,toggle]=l.useState(false);
  const [confirm,setConfirm]=l.useState(null);
  const [busy,setBusy]=l.useState(false);
  const [error,setError]=l.useState("");
  const exit=state.leyraExit;
  if(state.conn.status!=="connected"||!exit)return null;
  const ready=exit.entries.filter(line=>line.state==="ready"&&line.id!==exit.activeId&&line.id!==exit.selectedId);
  const recommended=ready.find(line=>line.expected!==exit.expected);
  const recovering=exit.phase!=="verified";
  const titles={timeout:"上游连接超时",unreachable:"上游线路不通",mismatch:"出口 IP 不一致",
    checking:"正在核验出口",manual:"正在切换线路","no-route":"没有已登记的独享线路",
    controller:"保护控制器异常",http:"Claude 检测页未通过",tls:"安全连接失败",response:"无法读取出口 IP"};
  const detail=line=>line.state==="ready"?"实测 "+line.actual+" · 已通过":line.state==="mismatch"?
    "实测 "+line.actual+" · 与登记 IP 不一致":line.state==="failed"?titles[line.error]??"检测失败":"待检测";
  async function invoke(operation){
    setBusy(true);setError("");
    try{await operation();}catch(failure){setError(W(failure));}finally{setBusy(false);}
  }
  const button=(label,onClick,primary=false)=>H.jsx("button",{type:"button",className:"v1-btn sm"+(primary?" primary":" soft"),disabled:busy,onClick,children:label});
  return H.jsxs("section",{className:"v1-card leyra-exit-card","aria-label":"Claude 出口线路",children:[
    H.jsx("strong",{children:recovering?(titles[exit.reason]??"Claude 出口尚未核验")+" · Claude 已暂停":exit.reason==="same-ip"?"线路已自动恢复，独享 IP 未变":"Claude 独享线路已核验"}),
    recovering&&H.jsx("p",{className:"v1-muted",children:recommended?"有备用出口可用。可等待原出口恢复，或确认切换。":
      "普通网页可以继续使用。"+(exit.nextAt?"下次复查 "+new Date(exit.nextAt).toLocaleTimeString("zh-CN",{hour12:false})+"。":"正在准备复查。")}),
    H.jsxs("div",{className:"leyra-exit-actions",children:[
      recovering&&recommended&&button("确认切换到推荐线路",()=>setConfirm({...recommended,from:exit.expected}),true),
      button(expanded?"收起线路":"切换线路",()=>toggle(!expanded)),
      expanded&&button("检测所有路线",()=>void invoke(()=>u.claudeExitInspect()))
    ]}),
    expanded&&H.jsx("div",{children:exit.entries.map(line=>H.jsxs("div",{className:"v1-row",children:[
      H.jsxs("span",{children:[line.name," · ",line.expected,line.id===exit.activeId?"（使用中）":""]}),
      H.jsx("span",{className:"v1-muted",children:detail(line)+(line.at?" · "+new Date(line.at).toLocaleTimeString("zh-CN",{hour12:false}):"")}),
      line.state==="ready"&&line.id!==exit.activeId&&line.id!==exit.selectedId&&button("选用",()=>setConfirm({...line,from:exit.expected}))
    ]},line.id))}),
    confirm&&H.jsxs("div",{className:"leyra-exit-confirm",children:[
      H.jsx("p",{children:"Claude 出口 "+(confirm.from??"—")+" → "+confirm.expected+"。再次核验通过后恢复。"}),
      button("确认",()=>void invoke(async()=>{await u.claudeExitChoose(confirm.id,confirm.from,confirm.expected);setConfirm(null);}),true),
      button("取消",()=>setConfirm(null))
    ]}),
    error&&H.jsx("p",{className:"error",role:"alert",children:error})
  ]});
}
