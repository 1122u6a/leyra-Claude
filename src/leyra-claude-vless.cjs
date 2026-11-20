'use strict'

const {isIP} = require('node:net')
const {claudeHost} = require('./leyra-routing.cjs')

const group = 'Claude 独享出口'
const node = 'Claude VLESS'
const claudePrograms = /^claude(?: helper(?: \([^)]*\))?)?(?:\.exe)?$/i

function read(profile) {
  const setting = require('./vless-tools.cjs').configured(profile)
  return setting ? fromSetting(setting) : null
}

function fromSetting(setting) {
  if(!isIP(setting.expectedIp))throw Error('Claude VLESS 出口配置无效')
  return {id:setting.id,expectedIp:setting.expectedIp,proxy:makeProxy(setting)}
}

function makeProxy(setting) {
  const {server, port, uuid, servername, publicKey, shortId} = setting
  const hostname = /^[a-z\d](?:[a-z\d.-]{0,251}[a-z\d])?$/i
  if (!(hostname.test(server) || isIP(server)) || !hostname.test(servername) ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(uuid) ||
      !/^[\w-]{42,43}$/.test(publicKey) ||
      !/^(?:[a-f\d]{2}){1,8}$/i.test(shortId)) {
    throw new Error('Claude VLESS 出口配置无效')
  }
  return {
    name: node, type: 'vless', server, port, uuid, network: 'tcp',
    tls: true, servername, 'client-fingerprint': setting.fingerprint, ...(setting.flow?{flow:setting.flow}:{}),
    'reality-opts': {'public-key': publicKey, 'short-id': shortId}
  }
}

function apply(config, setting, gate, line) {
  if (!setting) return
  config.proxies.push(setting.proxy)
  config['proxy-groups'].push({name: group, type: 'select', proxies: ['REJECT', node]})
  config.rules = config.rules.map(rule => {
    const fields = rule.split(',')
    const [kind, value, target] = fields
    if (target !== gate && target !== line) return rule
    const matches =
      (kind === 'DOMAIN' || kind === 'DOMAIN-SUFFIX') && claudeHost(value) ||
      kind === 'RULE-SET' && value === 'ain-claude-core' ||
      kind === 'PROCESS-NAME' && claudePrograms.test(value) ||
      kind === 'PROCESS-PATH-REGEX' && /\/Applications\/Claude\\x2eapp\/Contents\/$/.test(value) ||
      kind === 'IP-CIDR' && value === '160.79.104.0/21' ||
      kind === 'IP-CIDR6' && value === '2607:6bc0::/48'
    if (!matches) return rule
    fields[2] = group
    return fields.join(',')
  })
  const policy = config.dns['nameserver-policy']
  for (const key of Object.keys(policy)) {
    if (key.split(',').every(domain => claudeHost(domain.trim().replace(/^\+\./, '')))) {
      policy[key] = ['https://1.1.1.1/dns-query#' + node]
    }
  }
}

module.exports = {read, fromSetting, makeProxy, apply, group, node}
