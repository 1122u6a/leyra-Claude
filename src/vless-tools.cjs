'use strict'

const {createHash, randomBytes} = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const {isIP} = require('node:net')
const os = require('node:os')
const path = require('node:path')
const rules = require('./mobile-rules.json')

const fields = ['uuid', 'server', 'port', 'servername', 'publicKey', 'shortId', 'fingerprint', 'flow']
const hostPattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i
const keyPattern = /^[a-z0-9_-]{42,43}$/i
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const shortIdPattern = /^(?:[a-f0-9]{2}){1,8}$/i
const configFile = 'Leyra-iPhone-Claude-VLESS.conf'
const selectedFile = 'vless-selected.json'
const legacyFile = 'claude-vless.json'
const counterFile = 'vless-traffic.json'
const bytes = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
const identifier = node => createHash('sha256').update(JSON.stringify(fields.map(key => node[key]))).digest('hex').slice(0, 24)

function read(profile, file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(profile, file), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

function save(profile, file, value) {
  const destination = path.join(profile, file)
  const temp = destination + '.' + randomBytes(6).toString('hex')
  try {
    fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600, flag: 'wx'})
    fs.renameSync(temp, destination)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

function parse(input) {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('请粘贴完整的 VLESS 链接。')
  const normalized = input.trim().replace(/^vless\\:/i, 'vless:').replaceAll('\\.', '.')
  if (/\s/.test(normalized)) throw new Error('VLESS 链接中有空格或换行。')
  let url
  try { url = new URL(normalized) } catch { throw new Error('无法识别此 VLESS 链接。') }
  const params = url.searchParams
  const network = params.get('type') ?? 'tcp'
  const fingerprint = params.get('fp') || 'chrome'
  if (!(url.protocol === 'vless:' && !url.password && (url.pathname === '' || url.pathname === '/') &&
        (network === 'tcp' || network === 'raw') && params.get('security') === 'reality' &&
        ['','xtls-rprx-vision'].includes(params.get('flow') ?? '') &&
        ['','none'].includes(params.get('encryption') ?? '') &&
        ['chrome','firefox','safari','edge','ios','android','qq','random','randomized'].includes(fingerprint))) {
    throw new Error('目前支持 VLESS + REALITY 的 TCP 链接，可使用 XTLS Vision。')
  }
  const server = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const setting = {
    uuid: url.username.toLowerCase(), server, port: Number(url.port),
    servername: (params.get('sni') || server).toLowerCase(),
    publicKey: params.get('pbk') ?? '', shortId: (params.get('sid') ?? '').toLowerCase(),
    fingerprint, flow: params.get('flow') ?? ''
  }
  if (!(hostPattern.test(server) || isIP(server)) || !hostPattern.test(setting.servername) ||
      !uuidPattern.test(setting.uuid) || !keyPattern.test(setting.publicKey) ||
      !shortIdPattern.test(setting.shortId) || setting.port < 1 || setting.port > 65535) {
    throw new Error('请检查节点地址、端口、UUID、REALITY 公钥和 Short ID。')
  }
  let name
  try { name = decodeURIComponent(url.hash.slice(1)) } catch { throw new Error('VLESS 节点备注编码无效。') }
  return {...setting,id:identifier(setting),name:name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,80) || 'VLESS REALITY'}
}

function oldNode(profile) {
  const legacy = read(profile, legacyFile)
  if (!legacy) return null
  const setting = {...legacy,flow:'xtls-rprx-vision',fingerprint:'chrome'}
  return {...setting,id:identifier(setting),name:'Claude VLESS',legacy:true}
}

function catalog(profile) {
  const imported = Object.values(read(profile, 'vless-nodes.json', {}))
  const old = oldNode(profile)
  return old ? [old, ...imported.filter(entry => entry.id !== old.id)] : imported
}

function find(profile, id) {
  const node = catalog(profile).find(entry => entry.id === id)
  if (!node) throw new Error('找不到这条 VLESS 节点。')
  return node
}

function add(profile, input) {
  const node = parse(input)
  const imported = read(profile, 'vless-nodes.json', {})
  if (!Object.hasOwn(imported,node.id) && Object.keys(imported).length >= 50) throw new Error('最多可以保存 50 条 VLESS 节点。')
  save(profile,'vless-nodes.json',{...imported,[node.id]:node})
  return node.id
}

function configured(profile) {
  const selected = read(profile, selectedFile)
  if (selected) return {...find(profile,selected.id), expectedIp:selected.expectedIp}
  return oldNode(profile)
}

function select(profile, id, expectedIp) {
  find(profile, id)
  if (typeof expectedIp !== 'string' || !isIP(expectedIp.trim())) throw new Error('请输入已核实的独享出口 IP。')
  save(profile, selectedFile, {id,expectedIp:expectedIp.trim()})
}

function reset(profile) {
  fs.rmSync(path.join(profile,selectedFile),{force:true})
}

function summary(profile, runtime) {
  const configuredNode = configured(profile)
  const totals = read(profile,counterFile,{totals:{}}).totals
  return {
    configuredId:configuredNode?.id ?? null, runtimeId:runtime?.id ?? null,
    hasSelection:fs.existsSync(path.join(profile,selectedFile)),
    nodes:catalog(profile).map(({id,name,expectedIp}) => ({
      id,name,expectedIp:id === configuredNode?.id ? configuredNode.expectedIp : expectedIp ?? '',
      upload:bytes(totals[id]?.upload),download:bytes(totals[id]?.download)
    })),
    addresses:Object.entries(os.networkInterfaces()).flatMap(([name,interfaces]) =>
      /^en\d+$/.test(name) ? (interfaces ?? []).filter(entry => !entry.internal && entry.family === 'IPv4' &&
        /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(entry.address)).map(entry => entry.address) : [])
  }
}

function sample(profile, runtime, connections) {
  if (!runtime) return
  const state = read(profile,counterFile,{totals:{},active:{}})
  const previousConnections = state.activeNode === runtime.id ? state.active : {}
  const total = state.totals[runtime.id] ?? {upload:0,download:0}
  const active = {}
  let changed = false
  // Keep active connection baselines on disk to avoid counting them twice after a restart.
  for (const connection of connections) {
    if (!connection.chains?.some(name=>name==='Claude VLESS'||name==='Claude VLESS '+runtime.id) || !/^[a-f0-9-]{36}$/i.test(connection.id)) continue
    const upload = bytes(connection.upload)
    const download = bytes(connection.download)
    const previous = previousConnections[connection.id]
    const deltaUp = previous ? Math.max(0,upload - previous.upload) : upload
    const deltaDown = previous ? Math.max(0,download - previous.download) : download
    total.upload += deltaUp
    total.download += deltaDown
    active[connection.id] = {upload,download}
    changed ||= !previous || deltaUp > 0 || deltaDown > 0
  }
  if (!changed && Object.keys(active).length === Object.keys(state.active).length) return
  state.totals[runtime.id] = total
  state.active = active
  state.activeNode = runtime.id
  save(profile,counterFile,state)
}

function phoneName(node) {
  return node.legacy ? 'Leyra-Claude-VLESS' : 'Leyra-Claude-VLESS-' + node.id.slice(0,8)
}

function phoneLink(node) {
  const host = isIP(node.server) === 6 ? '[' + node.server + ']' : node.server
  const params = new URLSearchParams({
    type:'tcp',security:'reality',pbk:node.publicKey,fp:node.fingerprint,sni:node.servername,
    sid:node.shortId,flow:node.flow,encryption:'none'
  })
  return `vless://${node.uuid}@${host}:${node.port}?${params}#${phoneName(node)}`
}

function phoneConfig(node) {
  const route = (name, current) => rules[name].map(rule => {
    const [kind,target,...options] = rule.split(',')
    return [kind,target,current,...options].join(',')
  })
  return [
    '#!name=Leyra iPhone Claude VLESS',
    '[General]','ipv6 = true','udp-policy-not-supported-behaviour = REJECT','block-quic = all-proxy','',
    '[Proxy Group]',`CLAUDE-VLESS = select,policy-regex-filter=^${phoneName(node)}$`,'',
    '[Rule]',...route('claude-core','CLAUDE-VLESS'),'DOMAIN-SUFFIX,claudemcpcontent.com,CLAUDE-VLESS',
    ...route('chatgpt-core','PROXY'),...route('gemini-core','PROXY'),'FINAL,DIRECT',''
  ].join('\n')
}

const downloads = new Map()
async function serve(profile, id, address) {
  const node = find(profile,id)
  if (!summary(profile,null).addresses.includes(address)) throw new Error('请选择 Mac 当前的局域网地址。')
  let download = downloads.get(address)
  if (!download) {
    download = {configs:new Map()}
    download.server = http.createServer((request,response) => {
      const result = download.configs.get(request.url)
      if (request.method !== 'GET' || !result || result.expires < Date.now()) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store',
        'Content-Disposition':`attachment; filename="${configFile}"`}).end(result.content)
    })
    download.ready = new Promise((resolve,reject) => {
      download.server.once('error',reject)
      download.server.listen(0,address,resolve)
    })
    downloads.set(address,download)
  }
  try {
    await download.ready
  } catch {
    downloads.delete(address)
    throw new Error('无法在此局域网地址生成二维码。')
  }
  download.server.unref()
  clearTimeout(download.close)
  const expires = Date.now()+20*60*1000
  download.close = setTimeout(() => {
    downloads.delete(address)
    download.server.close()
  },20*60*1000)
  download.close.unref()
  for (const [token,config] of download.configs) {
    if (config.expires < Date.now()) download.configs.delete(token)
  }
  const token = '/' + randomBytes(18).toString('hex') + '/' + configFile
  download.configs.set(token,{content:phoneConfig(node),expires})
  return {nodeUrl:phoneLink(node),nodeName:phoneName(node),
    configUrl:`http://${address}:${download.server.address().port}${token}`}
}

module.exports = {add,configured,find,parse,phoneConfig,phoneLink,reset,sample,select,serve,summary,configFile}
