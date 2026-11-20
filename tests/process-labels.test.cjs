const test = require('node:test')
const assert = require('node:assert/strict')
const {diagnosticProcessName} = require('../src/process-labels.cjs')

test('legacy helpers have a Leyra display name', () => {
  for (const name of ['AI Network Helper', 'AI Network Helper (Renderer)', 'AI Network Helper (GPU)', 'AI Network Helper.exe']) {
    assert.equal(diagnosticProcessName(name), 'Leyra 后台组件')
  }
  assert.equal(diagnosticProcessName('AI Network.exe'), 'Leyra')
})

test('third-party process names and similar prefixes remain searchable', () => {
  for (const name of ['codex', 'curl', 'Clash Party Helper', 'AI Network Helper Test']) {
    assert.equal(diagnosticProcessName(name), name)
  }
  assert.equal(diagnosticProcessName(undefined), '')
})
