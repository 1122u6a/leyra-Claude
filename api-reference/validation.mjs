import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {isMobile,mobileClient} from './mobile.mjs';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const reject = message => { throw new HttpError(400,'invalid_request',message); };

export function normalizedEmail(input) {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)) {
    reject('请输入有效的邮箱。');
  }
  return email;
}

export function password(input, minimum=8) {
  if (typeof input !== 'string' || input.length < minimum || input.length > 128) {
    reject('请输入有效密码（8 至 128 个字符）。');
  }
  return input;
}

export function name(input, allowEmpty=false) {
  const value = typeof input === 'string' ? input.trim() : '';
  if ((!allowEmpty && !value) || value.length>40 || /[\x00-\x1f\x7f]/.test(value)) reject('名称应在 40 个字符以内。');
  return value;
}

export function parseDevice(input) {
  const expectedClient=isMobile(input.platform)?mobileClient[input.platform]:
    (['macos','windows','linux'].includes(input.platform)?'clash-verge-rev':null);
  if (!expectedClient || input.client !== expectedClient ||
      !['split','ai-only'].includes(input.mode ?? 'ai-only') ||
      typeof input.homeRegion !== 'string' || !/^[A-Za-z]{2}$/.test(input.homeRegion)) {
    reject('设备平台、客户端或地区配置不正确。');
  }
  return {name:name(input.name),client:input.client,platform:input.platform,
    region:input.homeRegion.toUpperCase(),mode:input.mode ?? 'ai-only'};
}

export function parseLine(input, previous) {
  const host = typeof input.server === 'string' ? input.server.trim() : '';
  const domain = /^[a-z0-9.-]{1,253}$/i.test(host) && host.includes('.') && host.split('.')
    .every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if ((!isIP(host) && !domain) || !isIP(input.exitIp ?? '') ||
      !['http','socks5'].includes(input.type) ||
      !Number.isInteger(Number(input.port)) || Number(input.port)<1 || Number(input.port)>65535) {
    reject('请检查协议、服务器地址、端口和出口 IP。');
  }
  const credential = /^[^\s,#"'\\\x00-\x1f\x7f]{1,128}$/;
  const secret = input.password ?? previous?.password;
  if (typeof input.username!=='string' || typeof secret!=='string' ||
      !credential.test(input.username) || !credential.test(secret)) reject('请填写有效的线路账号和密码。');
  return {type:input.type,server:isIP(host)?host:domainToASCII(host).toLowerCase(),port:Number(input.port),
    username:input.username,password:secret,exitIp:input.exitIp};
}
