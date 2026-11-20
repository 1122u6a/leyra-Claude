'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {isIP} = require('node:net');

const run = promisify(execFile);
const zoneRoots = ['/var/db/timezone/zoneinfo/', '/usr/share/zoneinfo/'];

function validZone(zone) {
  if (typeof zone !== 'string' || zone.length > 96 ||
      !/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en', {timeZone: zone});
    return zoneRoots.some(root => fs.existsSync(root + zone));
  } catch {
    return false;
  }
}

function canonical(zone) {
  return validZone(zone) ? new Intl.DateTimeFormat('en', {timeZone: zone}).resolvedOptions().timeZone : '';
}

function sameZone(a, b) {
  return !!a && !!b && (a === b || (canonical(a) && canonical(a) === canonical(b)));
}

function readZone() {
  const target = fs.readlinkSync('/etc/localtime');
  const prefix = zoneRoots.find(root => target.startsWith(root));
  const zone = prefix && target.slice(prefix.length);
  if (!validZone(zone)) throw new Error('无法识别 macOS 当前时区。');
  return {zone, target};
}

const authorizationScript = `
on run argv
  set expectedLink to item 1 of argv
  set targetZone to item 2 of argv
  set shellCommand to "if [ \\"$(/usr/bin/readlink /etc/localtime)\\" != " & quoted form of expectedLink & " ]; then exit 75; fi; /usr/sbin/systemsetup -settimezone " & quoted form of targetZone
  do shell script shellCommand with administrator privileges
end run
`;

async function writeZone(expected, zone) {
  if (!validZone(zone) || !zoneRoots.includes(expected.target.slice(0, -expected.zone.length)) ||
      !validZone(expected.zone)) throw new Error('时区参数无效。');
  try {
    await run('/usr/bin/osascript', ['-e', authorizationScript, expected.target, zone], {
      timeout: 120000, maxBuffer: 8192
    });
  } catch (error) {
    if (/\(-128\)/.test(error.stderr || '')) throw new Error('已取消 macOS 管理员授权。');
    if (/\(75\)/.test(error.stderr || '')) throw new Error('系统时区已被更改，请重新核对后再同步。');
    throw new Error('macOS 未完成时区更改，请检查管理员授权和系统日期与时间设置。');
  }
  if (!sameZone(readZone().zone, zone)) throw new Error('macOS 未保留设置的时区，请检查系统的自动时区设置。');
}

async function lookupTimezone(ip, fetcher) {
  if (!isIP(ip)) throw new Error('出口 IP 还没有完成验证。');
  const url = new URL('https://api.ipapi.is/');
  url.searchParams.set('q', ip);
  const response = await fetcher(url.href, {signal: AbortSignal.timeout(8500), cache: 'no-store', redirect: 'error'});
  if (!response.ok) throw new Error('出口时区查询暂不可用（HTTP ' + response.status + '）。');
  const data = await response.json();
  const zone = data.timezone ?? data.location?.timezone;
  if (data.ip !== ip || data.is_bogon || !validZone(zone)) {
    throw new Error('无法确认这个出口 IP 的具体时区。');
  }
  return {zone, location: [data.city, data.region, data.country].filter(value => typeof value === 'string').join(' · ').slice(0, 120)};
}

function createController({file, snapshot, fetcher, changed, read = readZone, write = writeZone, lookup = lookupTimezone, supported = process.platform === 'darwin'}) {
  let pending = Promise.resolve();
  let inFlight = null;
  let attempted = '';
  let manuallyChanged = false;
  let cache;
  let journal = null;
  let state = {current: null, target: null, location: null, phase: 'idle', detail: ''};

  if (supported) {
    try {
      state.current = read().zone;
    } catch {}
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (validZone(saved.before) && validZone(saved.target) &&
          (saved.prior == null || validZone(saved.prior))) journal = saved;
    } catch {}
    if (journal) state.detail = '上次有尚待核对的时区更改，可以恢复原时区。';
  }

  function update(patch) {
    state = {...state, ...patch};
    changed();
  }

  function status() {
    return {...state, supported, canRestore: !!journal};
  }

  function persist(value) {
    if (!value) {
      fs.rmSync(file, {force:true});
    } else {
      fs.mkdirSync(path.dirname(file), {recursive:true});
      const temporary = file + '.new';
      fs.writeFileSync(temporary, JSON.stringify(value), {mode:0o600});
      fs.renameSync(temporary, file);
    }
    journal = value;
  }

  function queue(task) {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  }

  function trySync(force = false) {
    if (!supported) return Promise.resolve();
    const start = snapshot();
    if (!start.enabled || !start.ip) {
      if (force) update({phase:'idle', detail:'请先开启自动同步，并连接到已验证的独享出口。'});
      return Promise.resolve();
    }
    const key = start.generation + ':' + start.ip;
    if (inFlight || (!force && (attempted === key || manuallyChanged))) return inFlight ?? Promise.resolve();
    attempted = key;
    inFlight = queue(async () => {
      try {
        let current = read();
        update({current:current.zone, phase:'checking', detail:'正在查询已验证出口的时区…'});
        const result = cache?.ip === start.ip && Date.now() - cache.at < 3600000
          ? cache : {...await lookup(start.ip, fetcher), ip:start.ip, at:Date.now()};
        const latest = snapshot();
        if (!latest.enabled || latest.ip !== start.ip || latest.generation !== start.generation) {
          update({phase:'idle', detail:'连接状态已变化，等待重新验证出口。'});
          return;
        }
        cache = result;
        current = read();
        if (journal && !sameZone(current.zone,journal.target) && !sameZone(current.zone,journal.prior)) {
          const wasManual = !sameZone(current.zone, journal.before);
          persist(null);
          if (wasManual && !force) {
            manuallyChanged = true;
            update({current:current.zone, target:result.zone, location:result.location,
              phase:'manual', detail:'检测到系统时区已手动更改，已暂停自动同步。'});
            return;
          }
        }
        if (!sameZone(current.zone, result.zone)) {
          persist({before:journal?.before ?? current.zone, target:result.zone, prior:current.zone});
          update({target:result.zone, location:result.location, phase:'authorization', detail:'请在 macOS 的授权提示中确认时区更改。'});
          await write(current, result.zone);
          persist({...journal, prior:null});
        }
        update({current:read().zone, target:result.zone, location:result.location, phase:'synced', detail:'系统时区与已验证出口一致。'});
      } catch (error) {
        // Leave the journal intact if the OS wrote the setting just before an error or timeout.
        let current = state.current;
        try { current = read().zone; } catch {}
        update({current, phase:'error', detail:error.message || '无法同步系统时区。'});
      }
    }).finally(() => {
      inFlight = null;
      const next = snapshot();
      if (next.enabled && next.ip && next.generation + ':' + next.ip !== key) {
        void trySync();
      }
    });
    return inFlight;
  }

  function restore() {
    if (!supported) return Promise.resolve(true);
    return queue(async () => {
      try {
        const current = read();
        const saved = journal;
        if (!saved) return true;
        const isOurZone = sameZone(current.zone, saved.target) || sameZone(current.zone, saved.prior);
        if (isOurZone && !sameZone(current.zone, saved.before)) {
          update({current:current.zone, phase:'authorization', detail:'请在 macOS 的授权提示中确认恢复原时区。'});
          await write(current, saved.before);
        }
        persist(null);
        update({current:read().zone, target:null, location:null, phase:'idle',
          detail:isOurZone ? '已恢复连接前的系统时区。' : '系统时区已发生其他变化，已保留当前设置。'});
        return true;
      } catch (error) {
        update({phase:'error', detail:error.message || '无法恢复原时区。'});
        return false;
      }
    });
  }
  function reset() { attempted = ''; manuallyChanged = false; }

  return {status, trySync, restore, reset};
}

module.exports = {createController, lookupTimezone, validZone, sameZone, authorizationScript};
