'use strict'

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const tls = require('node:tls')
const {createHash,randomBytes} = require('node:crypto')
const {isIP} = require('node:net')
const legacy = require('./leyra-claude-vless.cjs')
const {claudeHost}=require('./leyra-routing.cjs')
const tools = require('./vless-tools.cjs')

const pollMs=5000
const probeMs=4500
const accountId='account'
const fileName='claude-exit-choices.json'
const inbound='leyra-claude-probe'
const gatePrefix='Claude 核验保护 '
const traceHost='claude.ai'
const maxBackups=5

function load(profile) {
  try {return JSON.parse(fs.readFileSync(path.join(profile,fileName),'utf8'))}
  catch(error) {if(error.code==='ENOENT')return {ips:{}};throw error}
}

function save(profile,value) {
  const file=path.join(profile,fileName)
  const temp=file+'.'+randomBytes(6).toString('hex')
  try {
    fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600})
    fs.renameSync(temp,file)
  } finally {fs.rmSync(temp,{force:true})}
}

function normalize(ip) {
  if(isIP(ip)===6)return new URL('http://['+ip+']/').hostname.slice(1,-1)
  return isIP(ip)===4?ip:null
}

function register(profile,id,expected) {
  const value=normalize(String(expected??'').trim())
  if(!value)throw Error('未核验到有效的出口 IP。')
  tools.find(profile,id)
  const current=load(profile)
  if(!Object.hasOwn(current.ips,id)&&Object.keys(current.ips).length>=maxBackups)throw Error('最多登记 5 条 VLESS 备用路线。')
  const fixed=tools.configured(profile)
  const previous=current.ips[id]??(fixed?.id===id?fixed.expectedIp:null)
  if(previous&&value!==normalize(previous))throw Error('实测出口 IP 已变化，保留原登记 IP。请先向线路供应商核实。')
  if(Object.hasOwn(current.ips,id))return false
  current.ips[id]=value
  save(profile,current)
  return true
}

function routes(profile,accountIp,accountProxy) {
  const stored=load(profile)
  const fixed=tools.configured(profile)
  const entries=[]
  if(normalize(accountIp))entries.push({id:accountId,name:'账号独享线路',expected:normalize(accountIp),out:accountProxy})
  const registered={...stored.ips}
  if(fixed&&!registered[fixed.id])registered[fixed.id]=fixed.expectedIp
  for(const [id,expected] of Object.entries(registered)){
    if(!normalize(expected))continue
    const data=tools.find(profile,id)
    const line=legacy.fromSetting({...data,expectedIp:expected})
    const out='Claude VLESS '+id
    entries.push({id,name:data.name,expected:normalize(expected),out,proxy:{...line.proxy,name:out}})
  }
  const preferred=entries.find(line=>line.id===(stored.preferred??fixed?.id??accountId))??null
  return {entries,preferred}
}

function addProbeAndGate(config,routeData,secret) {
  const fingerprint=createHash('sha256').update(secret).digest()
  const probePort=49152+fingerprint.readUInt16BE(0)%12000
  const epoch=randomBytes(8).toString('hex')
  const gate=gatePrefix+epoch
  const password=randomBytes(24).toString('hex')
  const entries=routeData.entries.map((line,index)=>({...line,user:'probe'+index}))
  const preferred=entries.find(line=>line.id===routeData.preferred?.id)??null
  config.proxies.push(...entries.flatMap(line=>line.proxy?[line.proxy]:[]))
  config['proxy-groups'].push({name:gate,type:'select',proxies:['REJECT',...entries.map(line=>line.out)]})
  if(entries.length){
    config.listeners=[...(config.listeners??[]),{name:inbound,type:'http',listen:'127.0.0.1',port:probePort,
      users:entries.map(line=>({username:line.user,password}))}]
    config.rules.unshift(
      ...entries.map(line=>'AND,((IN-NAME,'+inbound+'),(IN-USER,'+line.user+'),(DOMAIN,'+traceHost+'),(DST-PORT,443)),'+line.out),
      'IN-NAME,'+inbound+',REJECT')
  }
  return {gate,entries,preferred,probePort,password}
}

function routeProtected(config,gate,shared,account) {
  config.rules=config.rules.map(rule=>{
    const parts=rule.split(',')
    if(parts[2]!==shared&&parts[2]!==account)return rule
    const [kind,value]=parts
    const protectedRule=(kind==='DOMAIN'||kind==='DOMAIN-SUFFIX')&&claudeHost(value)||
      kind==='RULE-SET'&&value==='ain-claude-core'||
      kind==='PROCESS-NAME'&&/^claude(?: helper(?: \([^)]*\))?)?(?:\.exe)?$/i.test(value)||
      kind==='IP-CIDR'&&value==='160.79.104.0/21'||
      kind==='IP-CIDR6'&&value==='2607:6bc0::/48'
    if(!protectedRule)return rule
    parts[2]=gate
    return parts.join(',')
  })
}

function isGate(name) {
  return typeof name==='string'&&name.startsWith(gatePrefix)
}

function isAuthenticatedProbeLog(line) {
  return /\[TCP\] 127\.0\.0\.1:\d+ --> claude\.ai:443 match AND\(\(\(InName,leyra-claude-probe\) && \(InUser,probe\d+\) && \(Domain,claude\.ai\) && \(DstPort,443\)\)\) using /.test(line)
}

function isAuthenticatedProbeConnection(connection) {
  const meta=connection.metadata
  return meta?.sourceIP==='127.0.0.1'&&meta.host===traceHost&&String(meta.destinationPort)==='443'&&
    meta.network==='tcp'&&meta.inboundName===inbound&&/^probe\d+$/.test(meta.inboundUser??'')&&
    connection.rule==='AND'
}

async function drainGroup(connections,group,remove) {
  const targets=connections.filter(item=>item.chains?.includes(group))
  await Promise.all(targets.map(item=>remove(item.id)))
}

function readProbe(context,line) {
  return new Promise(resolve=>{
    let request,secure,transport
    const clock=Date.now()
    const deadline=setTimeout(()=>finish({error:'timeout'}),probeMs)
    let settled=false
    function finish(value){
      if(settled)return
      settled=true
      clearTimeout(deadline)
      request?.destroy()
      secure?.destroy()
      transport?.destroy()
      resolve({...value,ms:Date.now()-clock})
    }
    const auth=Buffer.from(line.user+':'+context.password).toString('base64')
    transport=http.request({host:'127.0.0.1',port:context.probePort,method:'CONNECT',path:traceHost+':443',
      headers:{'Proxy-Authorization':'Basic '+auth}})
    transport.once('error',()=>finish({error:'unreachable'}))
    transport.once('connect',(response,socket,head)=>{
      if(response.statusCode!==200){socket.destroy();finish({error:'unreachable'});return}
      if(head.length)socket.unshift(head)
      secure=tls.connect({socket,servername:traceHost,rejectUnauthorized:true,minVersion:'TLSv1.2'})
      secure.once('error',()=>finish({error:'tls'}))
      const agent=new https.Agent({keepAlive:false})
      agent.createConnection=()=>secure
      request=https.get({hostname:traceHost,path:'/cdn-cgi/trace',agent,headers:{'Cache-Control':'no-cache'}},reply=>{
        if(reply.statusCode!==200){finish({error:'http'});return}
        let body=''
        reply.setEncoding('utf8')
        reply.on('data',piece=>{body+=piece;if(body.length>8192)finish({error:'response'})})
        reply.once('error',()=>finish({error:'response'}))
        reply.once('end',()=>{
          const ip=normalize(body.match(/^ip=([^\r\n]+)$/m)?.[1]?.trim()??'')
          finish(ip?{ip}:{error:'response'})
        })
      })
      request.once('error',()=>finish({error:'unreachable'}))
    })
    transport.end()
  })
}

class Guard {
  constructor(context,io) {
    this.context=context
    this.io=io
    this.selected=context.preferred
    this.active=null
    this.phase='waiting'
    this.results={}
    this.nextAt=null
    this.reason=null
    this.allowed=false
    this.stopped=false
    this.manualPending=false
    this.version=0
    this.queue=Promise.resolve()
    this.gateQueue=Promise.resolve()
  }

  state() {
    return {
      phase:this.phase,reason:this.reason,expected:this.selected?.expected??null,
      activeId:this.active?.id??null,selectedId:this.selected?.id??null,nextAt:this.nextAt,
      entries:this.context.entries.map(({id,name,expected})=>({id,name,expected,...this.results[id]}))
    }
  }

  publish() {if(!this.stopped)this.io.update(this.state())}

  run(operation) {
    const result=this.queue.then(()=>this.stopped?undefined:operation())
    this.queue=result.catch(()=>{})
    return result
  }

  stop() {
    this.stopped=true
    this.allowed=false
    this.version++
    clearTimeout(this.timer)
  }

  writeGate(out, valid=()=>true) {
    const change=this.gateQueue.then(()=>valid()?this.io.gate(out):undefined)
    this.gateQueue=change.catch(()=>{})
    return change
  }

  async block(reason='checking') {
    this.phase='blocked'
    this.reason=reason
    this.active=null
    this.publish()
    await this.writeGate(null)
    await this.io.drain()
  }

  revoke() {
    this.allowed=false
    this.version++
    clearTimeout(this.timer)
    this.nextAt=null
    return this.stopped?Promise.resolve():this.block('checking')
  }

  permit() {
    if(this.allowed)return this.queue
    this.allowed=true
    return this.scan()
  }

  fail(reason) {
    if(!this.active||!this.allowed)return this.queue
    this.version++
    clearTimeout(this.timer)
    this.nextAt=null
    return this.block(reason).then(()=>this.run(()=>this.schedule()))
  }

  schedule() {
    if(this.stopped||!this.allowed)return
    clearTimeout(this.timer)
    this.nextAt=Date.now()+pollMs
    this.timer=setTimeout(()=>void this.scan().catch(this.io.error),pollMs)
    this.timer.unref?.()
    this.publish()
  }

  async probe(line) {
    const result=await Promise.resolve().then(()=>this.io.probe(line)).catch(()=>({error:"unreachable"}))
    const state=result.ip===line.expected?'ready':result.ip?'mismatch':'failed'
    this.results[line.id]={state,actual:result.ip??null,error:result.error??null,at:Date.now(),ms:result.ms}
    return this.results[line.id]
  }

  scan() {
    return this.run(async()=>{
      if(!this.allowed)return
      clearTimeout(this.timer)
      this.nextAt=null
      if(!this.selected){
        await this.block('no-route')
        this.schedule()
        return
      }
      const epoch=this.version
      const current=()=>!this.stopped&&this.allowed&&epoch===this.version
      const active=this.active
      const primary=active??this.selected
      const pending=this.context.entries.filter(line=>line.id!==primary.id)
      const others=active?[]:pending.map(line=>this.probe(line))
      const result=await this.probe(primary)
      if(!current())return
      if(active&&result.state==='ready'){
        this.publish()
        this.schedule()
        return
      }
      if(!active||result.state!=='ready')await this.block(result.state==='ready'?'checking':result.error??result.state)
      if(active)others.push(...pending.map(line=>this.probe(line)))
      await Promise.all(others)
      if(!current())return
      const qualified=this.context.entries.filter(line=>line.expected===this.selected.expected&&this.results[line.id]?.state==='ready')
      const choice=qualified.find(line=>line.id===this.selected.id)??qualified[0]
      if(choice&&(!this.manualPending||choice.id===this.selected.id)){
        const second=await this.probe(choice)
        if(!current())return
        if(second.state==='ready'){
          await this.writeGate(choice.out,current)
          if(!current()){
            await this.writeGate(null)
            return
          }
          this.active=choice
          this.phase='verified'
          this.reason=choice.id===this.selected.id?'verified':'same-ip'
          this.manualPending=false
          this.io.verified(choice,second)
        }
      }
      this.publish()
      this.schedule()
    })
  }

  inspect() {
    return this.run(async()=>{
      if(!this.allowed)return
      await Promise.all(this.context.entries.map(line=>this.probe(line)))
      this.publish()
    })
  }

  choose(id,from,to) {
    return this.run(async()=>{
      const target=this.context.entries.find(line=>line.id===id)
      if(!this.allowed||!target||this.selected?.expected!==from||target.expected!==to||
         this.results[id]?.state!=='ready'){
        throw Error('线路状态已变化，请重新检测后确认。')
      }
      const epoch=this.version
      const latest=await this.probe(target)
      this.publish()
      if(latest.state!=='ready')throw Error('这条备用线路的出口未通过核验，请选择其他线路。')
      if(!this.allowed||this.stopped||epoch!==this.version)throw Error('网络状态已变化，请重新检测后确认。')
      await this.block('manual')
      if(!this.allowed||this.stopped||epoch!==this.version)throw Error('网络状态已变化，请重新检测后确认。')
      await this.io.saveChoice(id)
      this.selected=target
      this.manualPending=true
    }).then(()=>this.scan())
  }
}

module.exports={Guard,accountId,addProbeAndGate,drainGroup,isAuthenticatedProbeConnection,isAuthenticatedProbeLog,isGate,load,readProbe,register,routeProtected,routes,save}
