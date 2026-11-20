'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {domainToASCII} = require('node:url');
const {isIP} = require('node:net');

const claudeDomains = [
  'claude.ai', 'claude.com', 'anthropic.com', 'claudeusercontent.com',
  'claudemcpcontent.com', 'clau.de'
];
const claudePrograms = ['Claude', 'Claude Helper', 'claude', 'Claude.exe', 'claude.exe'];
const controlHosts = ['ainetid.com','client-api.leyra.xin'];
const covers = (domain, suffix) => domain === suffix || domain.endsWith('.' + suffix);
const overlaps = (domain, suffix) => covers(domain, suffix) || covers(suffix, domain);

function normalizeDomain(input) {
  if (typeof input !== 'string' || input.length > 1000) return '';
  const name = input.trim().replace(/^(?:\*\.|\+\.)/, '');
  if (/[\s\\@,()?#%]/.test(name)) return '';
  let domain;
  try {
    const parsed = new URL(/^https?:\/\//i.test(name) ? name : 'https://' + name);
    if (parsed.username || parsed.password) return '';
    domain = domainToASCII(parsed.hostname.replace(/\.$/, '')).toLowerCase();
  } catch {
    return '';
  }
  if (domain.length > 253 || isIP(domain) || !domain.includes('.')) return '';
  return domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ? domain : '';
}

function customDomain(input) {
  const domain = normalizeDomain(input);
  if (!domain || claudeDomains.some(base => overlaps(domain, base)) ||
      controlHosts.some(host => overlaps(domain, host)) || /\.(?:local|localhost|lan)$/.test(domain)) return '';
  return domain;
}

function appPath(input) {
  if (typeof input !== 'string' || input.length > 1024 || !path.isAbsolute(input) ||
      /[\x00-\x1f\x7f]/.test(input) || !/\.app$/i.test(input)) return '';
  return path.normalize(input);
}

function selectApp(input, currentApp) {
  const resolved = appPath(fs.realpathSync(input));
  if (!resolved || resolved === currentApp || /\/(?:System|Library)\/(?:Library|CoreServices)\//.test(resolved) ||
      !fs.statSync(path.join(resolved, 'Contents', 'MacOS')).isDirectory()) {
    throw new Error('请选择本机安装的第三方应用。Leyra 自身不能加入白名单。');
  }
  return resolved;
}

function sanitize(settings) {
  return {
    domains: [...new Set((Array.isArray(settings?.domains) ? settings.domains : [])
      .slice(0, 200).map(customDomain).filter(Boolean))].slice(0, 50),
    apps: [...new Set((Array.isArray(settings?.apps) ? settings.apps : [])
      .slice(0, 200).map(appPath).filter(Boolean))].slice(0, 30)
  };
}

function claudeHost(host) {
  const normalized = String(host).toLowerCase().replace(/\.$/, '');
  return claudeDomains.some(domain => covers(normalized, domain));
}

// Encode syntax characters so app names cannot change either the regex or the rule tuple.
function appMatcher(bundle) {
  const prefix = bundle.replace(/[.*+?^$${}()|[\]\\,]/g, character =>
    '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0'));
  return 'PROCESS-PATH-REGEX,^' + prefix + '/Contents/';
}

function apply(config, options, gate, line) {
  const {domains, apps} = sanitize(options.leyraRoutes);
  const domainRules = [...new Set([...claudeDomains, ...domains])];
  const selectors = domainRules.map(domain => 'DOMAIN-SUFFIX,' + domain);
  if (options.tun) {
    const installedClaude = ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')];
    selectors.push(...[...new Set([...installedClaude, ...apps])].map(appMatcher));
    selectors.push(...claudePrograms.map(program => 'PROCESS-NAME,' + program));
  }
  if (options.localTool?.path) {
    // Leave the upstream proxy's own connections to the original upstream handling.
    const upstream = String(options.localTool.path);
    const found = selectors.findIndex(selector => selector.startsWith('PROCESS-PATH-REGEX,') &&
      new RegExp(selector.slice('PROCESS-PATH-REGEX,'.length)).test(upstream));
    if (found >= 0) selectors.splice(found, 1);
  }

  const priority = [
    'DOMAIN,localhost,DIRECT',
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR6,::1/128,DIRECT,no-resolve',
    ...selectors.flatMap(rule => [
      'AND,((NETWORK,UDP),(' + rule + ')),REJECT',
      rule + ',' + gate
    ])
  ];
  const firstOrdinary = config.rules.findIndex(rule => !/^PROCESS-(?:NAME|PATH),[^,]+,DIRECT$/.test(rule));
  const bootstrapCheck = config.rules.indexOf('DOMAIN,www.cloudflare.com,' + line);
  // The app must still be able to verify the dedicated line while the gate is closed.
  const index = bootstrapCheck >= 0 ? bootstrapCheck + 1
    : firstOrdinary < 0 ? config.rules.length : firstOrdinary;
  config.rules.splice(index, 0, ...priority);
  const dns = config.dns['nameserver-policy'] ?? {};
  config.dns['nameserver-policy'] = {
    ...Object.fromEntries(domainRules.map(domain => ['+.' + domain, ['https://1.1.1.1/dns-query#' + line]])),
    ...dns
  };
}

module.exports = {apply, appPath, selectApp, sanitize, customDomain, covers, claudeHost};
