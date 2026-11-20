function wd(log,connected,now=Date.now(),blocked=false,output=null){
  const start=now-86400000,hourMs=3600000;
  const events=[];
  let color="none",openBlock=null;
  const segments=[];
  for(const row of log){
    const time=Date.parse(row.at);
    if(!Number.isFinite(time)||time>now)continue;
    let next=null;
    if(gd.has(row.kind))next="none";
    else if(_d.has(row.kind)||row.kind==="拦截 Claude")next="blocked";
    else if(hd.has(row.kind)||row.kind==="切换")next="pending";
    else if(row.kind==="出口核对"){
      if(/^Claude 看到 [0-9a-f:.]+$/i.test(row.text))next="ok";
      else if(row.text.includes("读不到"))next="pending";
    }
    if(!next)continue;
    if(color!=="blocked"&&next==="blocked")openBlock=time;
    if(color==="blocked"&&next!=="blocked"&&openBlock!==null){
      segments.push({start:openBlock,end:time});openBlock=null;
    }
    color=next;
    events.push({time,color});
  }
  if(openBlock!==null)segments.push({start:openBlock,end:now});
  const current=!connected?"none":output?
    output.phase==="verified"?"ok":output.phase==="blocked"&&output.reason!=="checking"?"blocked":"pending":
    blocked?"blocked":color==="ok"?"ok":"pending";
  let index=0,latest="none";
  return Array.from({length:24},(_,bucket)=>{
    const left=start+bucket*hourMs,right=left+hourMs;
    while(index<events.length&&events[index].time<right){latest=events[index].color;index++;}
    const blocks=segments.filter(block=>block.start<right&&block.end>left).map(block=>({
      start:Math.max(left,block.start),ms:Math.min(right,block.end)-Math.max(left,block.start)
    }));
    return {st:bucket===23?current:latest,blocks,ongoing:bucket===23&&current==="blocked"};
  });
}

function Td(hour,formatTime){
  const status={ok:"出口核验通过",none:"未连接",pending:"等待出口核验",blocked:"Claude 已拦截"}[hour.st];
  return hour.blocks.length?status+"。该时段发生过拦截："+hour.blocks.map(block=>formatTime(block.start)).join("、"):status;
}
