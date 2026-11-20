const proxyName = 'Leyra';
export const mobileClient = Object.freeze({ios:'shadowrocket',android:'clash-meta-android'});
export const isMobile = platform => Object.hasOwn(mobileClient,platform);
export const mobileFilename = platform => platform==='ios'?'leyra.conf':'leyra.yaml';

function getRules(rules) {
  return [...new Set(['claude-core','chatgpt-core','gemini-core']
    .flatMap(name=>rules[name]??[]))];
}

function withPolicy(rule,policy) {
  const [kind,match,...options]=rule.split(',');
  return [kind,match,policy,...options].join(',');
}

export const iosSelectedProfileFilename = 'leyra-selected.conf';

export function iosSelectedProfile(rules) {
  const content=[
    '[General]',
    'ipv6 = true',
    '',
    '[Rule]',
    ...getRules(rules).map(rule=>withPolicy(rule,'PROXY')),
    'FINAL,DIRECT',
    ''
  ].join('\n');
  return {content,type:'text/plain; charset=utf-8'};
}

export function mobileProfile(platform,line,rules) {
  const protectedRules = getRules(rules);
  if(platform==='ios'){
    const protocol=line.type==='socks5'?'socks5':'http';
    const remote= [protocol,line.server,line.port,'username='+line.username,'password='+line.password].join(', ');
    const content=[
      '[General]',
      'ipv6 = true',
      '',
      '[Proxy]',
      proxyName+' = '+remote,
      '',
      '[Rule]',
      ...protectedRules.map(rule=>withPolicy(rule,proxyName)),
      'FINAL,DIRECT',
      ''
    ].join('\n');
    return {content,type:'text/plain; charset=utf-8'};
  }
  const proxy={
    name:proxyName,type:line.type,server:line.server,port:line.port,
    username:line.username,password:line.password,udp:false
  };
  return {
    content:JSON.stringify({
      'allow-lan':false,mode:'rule',ipv6:true,proxies:[proxy],
      rules:[
        ...protectedRules.map(rule=>'AND,((NETWORK,UDP),('+rule.replace(/,no-resolve$/,'')+')),REJECT'),
        ...protectedRules.map(rule=>withPolicy(rule,proxyName)),
        'MATCH,DIRECT'
      ]
    },null,2)+'\n',
    type:'text/yaml; charset=utf-8'
  };
}
