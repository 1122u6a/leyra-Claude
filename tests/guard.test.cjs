const {test} = require('node:test')
const assert = require('node:assert/strict')
const {Guard, addProbeAndGate, drainGroup, isAuthenticatedProbeLog, isAuthenticatedProbeConnection, register, routes} = require('../src/claude-exit-guard.cjs')
const {add} = require('../src/vless-tools.cjs')
const {mkdtempSync, rmSync} = require('node:fs')
const {tmpdir} = require('node:os')
const {join} = require('node:path')

function fixture(t) {
  const entries = [
    {id: 'account', name: 'Primary', expected: '192.0.2.10', out: 'primary'},
    {id: 'same', name: 'Same IP', expected: '192.0.2.10', out: 'alternate'},
    {id: 'different', name: 'Different IP', expected: '192.0.2.20', out: 'third'}
  ]
  const seen = {account: '192.0.2.10', same: '192.0.2.10', different: '192.0.2.20'}
  const calls = []
  let gate = null
  const guard = new Guard({entries, preferred: entries[0]}, {
    probe: async ({id}) => {
      calls.push(['probe', id])
      return seen[id] ? {ip: seen[id], ms: 5} : {error: 'timeout', ms: 5}
    },
    gate: async (choice) => { gate = choice; calls.push(['gate', choice]) },
    drain: async () => { calls.push(['drain']) },
    saveChoice: async (id) => { calls.push(['save', id]) },
    update: () => {},
    verified: () => {},
    error: (error) => { throw error }
  })
  t.after(() => guard.stop())
  return {guard, seen, calls, currentGate: () => gate, entries}
}

test('startup requires two matching probes before opening the primary', async (t) => {
  const {guard, calls, currentGate} = fixture(t)
  assert.equal(currentGate(), null)
  await guard.permit()
  const opening = calls.findIndex(([action, value]) => action === 'gate' && value === 'primary')
  assert.equal(calls.slice(0, opening).filter(([action, value]) => action === 'probe' && value === 'account').length, 2)
  assert.equal(guard.state().phase, 'verified')
})

test('same IP recovers automatically and different IP waits for explicit selection', async (t) => {
  const {guard, seen, calls, currentGate} = fixture(t)
  await guard.permit()

  seen.account = null
  await guard.scan()
  assert.equal(currentGate(), 'alternate')
  assert.equal(guard.state().reason, 'same-ip')
  assert(calls.findLastIndex(([action]) => action === 'drain') < calls.length - 1)

  seen.same = null
  await guard.scan()
  assert.equal(currentGate(), null)
  assert.equal(guard.state().entries.find(({id}) => id === 'different').state, 'ready')
  assert(!calls.some(([action]) => action === 'save'))

  await assert.rejects(guard.choose('different', '192.0.2.99', '192.0.2.20'))
  await guard.choose('different', '192.0.2.10', '192.0.2.20')
  assert.equal(currentGate(), 'third')
  assert(calls.some(([action, id]) => action === 'save' && id === 'different'))
})

test('mismatched or unavailable endpoints leave the gate closed', async (t) => {
  const {guard, seen, currentGate} = fixture(t)
  await guard.permit()
  seen.account = '192.0.2.99'
  seen.same = null
  seen.different = null
  await guard.scan()
  assert.equal(currentGate(), null)
  assert.equal(guard.state().reason, 'mismatch')
  assert(!guard.state().entries.some(({state}) => state === 'ready'))
  seen.account = '192.0.2.10'
  await guard.scan()
  assert.equal(currentGate(), 'primary')
})

test('probe listener is authenticated and the protection group defaults to REJECT', (t) => {
  const {entries} = fixture(t)
  const config = {proxies: [], 'proxy-groups': [], rules: ['MATCH,DIRECT']}
  const result = addProbeAndGate(config, {entries, preferred: entries[0]}, 'fixture')
  assert.equal(config['proxy-groups'][0].proxies[0], 'REJECT')
  assert.equal(config.listeners[0].listen, '127.0.0.1')
  assert.equal(config.listeners[0].users.length, entries.length)
  assert(config.rules.some((rule) => rule.endsWith(',REJECT')))
  assert.equal(result.entries.length, entries.length)
})

test('only existing protected flows are drained', async () => {
  const deleted = []
  await drainGroup([{id: 'protected', chains: ['guard', 'primary']}, {id: 'ordinary', chains: ['DIRECT']}],
    'guard', async (id) => { deleted.push(id) })
  assert.deepEqual(deleted, ['protected'])
})


test('auto-discovered IP becomes a backup and its registered IP stays pinned', (t) => {
  const profile = mkdtempSync(join(tmpdir(), 'leyra-handoff-'))
  t.after(() => rmSync(profile, {recursive: true, force: true}))
  const synthetic = 'vless://11111111-2222-4333-8444-555555555555@example.invalid:443' +
    '?security=reality&type=tcp&sni=example.invalid&pbk=' + 'A'.repeat(43) +
    '&sid=12&flow=xtls-rprx-vision&encryption=none#Backup'
  const id = add(profile, synthetic)
  assert.equal(register(profile, id, '192.0.2.20'), true)
  const loaded = routes(profile, '192.0.2.10', 'primary')
  assert.equal(loaded.preferred.id, 'account')
  assert.equal(loaded.entries.find((line) => line.id === id).expected, '192.0.2.20')
  assert.throws(() => register(profile, id, '192.0.2.30'), /实测出口 IP 已变化/)
})

test('manual selection probes the candidate before closing the current route', async (t) => {
  const {guard, seen, calls, currentGate} = fixture(t)
  await guard.permit()
  seen.different = '192.0.2.99'
  const eventStart = calls.length
  await assert.rejects(guard.choose('different', '192.0.2.10', '192.0.2.20'), /未通过核验/)
  assert.equal(currentGate(), 'primary')
  assert.deepEqual(calls.slice(eventStart), [['probe', 'different']])
})

test('only the authenticated internal probe is excluded from connection diagnostics', () => {
  const coreLine = '[TCP] 127.0.0.1:52232 --> claude.ai:443'
  const internal = coreLine + ' match AND(((InName,leyra-claude-probe) && (InUser,probe1) && (Domain,claude.ai) && (DstPort,443))) using Candidate'
  assert(isAuthenticatedProbeLog(internal))
  assert(!isAuthenticatedProbeLog(coreLine + ' match Match using DIRECT'))
  const meta = {sourceIP: '127.0.0.1', host: 'claude.ai', destinationPort: 443,
    network: 'tcp', inboundName: 'leyra-claude-probe', inboundUser: 'probe1'}
  assert(isAuthenticatedProbeConnection({rule: 'AND', metadata: meta}))
  assert(!isAuthenticatedProbeConnection({rule: 'AND', metadata: {...meta, inboundUser: ''}}))
  assert(!isAuthenticatedProbeConnection({rule: 'Match', metadata: {...meta, inboundName: 'mixed'}}))
})
