'use strict';

function relayName(value) {
  const relay=typeof value==='string'?value.trim():'';
  if(!relay||relay.length>128||/[\x00-\x1f\x7f]/.test(relay)){
    throw new Error('请填写小火箭里的前置节点名称。');
  }
  return relay;
}

async function prepareIphoneSetup(confUrl,frontNode,apiBase,fetchConfig=fetch) {
  const relay=relayName(frontNode);
  const original=new URL(confUrl);
  if(original.protocol!=='https:'||original.origin!==new URL(apiBase).origin||
     !/^\/v1\/line\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}\/leyra\.conf$/.test(original.pathname)||
     original.username||original.password||original.search||original.hash) throw new Error('iPhone 配置地址无效。');
  let response;
  try {
    response=await fetchConfig(original,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
  } catch {
    throw new Error('无法读取 iPhone 线路配置，请稍后重试。');
  }
  if(!response.ok) throw new Error('无法读取 iPhone 线路配置，请检查永久授权。');
  const config=await response.text();
  const node=config.match(/^Leyra = (socks5|http), ([^,\s]+), (\d+), username=([^,\r\n]+), password=([^\r\n]+)$/m);
  if(!node) throw new Error('无法识别 iPhone 线路字段。请检查独享线路。');
  const [,scheme,server,port,user,password]=node;
  if(scheme!=='socks5')throw new Error('iPhone 前置节点流程需要 SOCKS5 独享线路。');
  const name='Leyra iPhone '+original.pathname.split('/')[3].slice(0,6)+'-R';
  if(name.toLowerCase()===relay.toLowerCase()) throw new Error('前置节点不能选择这台 iPhone 的独享节点。');
  const host=server.includes(':')?'['+server+']':server;
  const endpoint=new URL('socks5://'+host+':'+port);
  endpoint.username=user;
  endpoint.password=password;
  // Keep the interoperable standalone format used by the working node.
  // The selected relay is confirmed in Shadowrocket after import.
  endpoint.hash=name;
  const selected=new URL(original);
  selected.pathname=selected.pathname.replace(/leyra\.conf$/,'leyra-selected.conf');
  return {confUrl:selected.href,nodeUrl:endpoint.href,nodeName:name,frontNode:relay};
}

module.exports={relayName,prepareIphoneSetup};
