'use strict'

function diagnosticProcessName(processName) {
  if (typeof processName !== 'string' || !processName) return ''
  const legacy = /^AI Network(?: Helper(?: \((?:Renderer|GPU|Plugin)\))?)?(?:\.exe)?$/i
  if (!legacy.test(processName)) return processName
  return /^AI Network Helper/i.test(processName) ? 'Leyra 后台组件' : 'Leyra'
}

module.exports = {diagnosticProcessName}
