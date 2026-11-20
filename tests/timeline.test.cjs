const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const {runInNewContext} = require('node:vm')

const code = readFileSync(join(__dirname, '..', 'design', 'timeline.js'), 'utf8')
const timeline = runInNewContext(code + '\nwd', {
  gd: new Set(['断开']),
  hd: new Set(['已连接']),
  _d: new Set(['拦截'])
})

test('last hour shows one status and keeps previous incidents', () => {
  const now = Date.UTC(2026, 10, 19, 10)
  const ago = ms => new Date(now - ms).toISOString()
  const log = [
    {kind:'出口核对', at:ago(7_200_010), text:'Claude 看到 192.0.2.10'},
    {kind:'拦截 Claude', at:ago(7_100_000), text:'上游连接超时'},
    {kind:'出口核对', at:ago(3_000_000), text:'Claude 看到 192.0.2.10'}
  ]
  const hours = timeline(log, true, now, false, {phase:'verified'})
  assert.equal(hours.length, 24)
  assert.equal(hours[22].st, 'blocked')
  assert.equal(hours[23].st, 'ok')
  assert(hours[23].blocks.length > 0)
  assert.equal(timeline(log, true, now, true, {phase:'blocked', reason:'timeout'})[23].st, 'blocked')
  assert.equal(timeline(log, true, now, false, {phase:'waiting'})[23].st, 'pending')
  assert.equal(timeline(log, false, now, false)[23].st, 'none')
})
