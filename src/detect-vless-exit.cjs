'use strict'

const {spawn} = require('node:child_process')
const {once} = require('node:events')
const {setTimeout: delay} = require('node:timers/promises')
const {randomBytes} = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {addProbeAndGate, readProbe} = require('./claude-exit-guard.cjs')
const {makeProxy} = require('./leyra-claude-vless.cjs')

function waitForListener(child, port) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => finish(Error('出口检测组件启动超时。')), 5000)
    function finish(error) {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('error', finish)
      child.off('exit', onExit)
      error ? reject(error) : resolve()
    }
    function onExit() { finish(Error('出口检测组件未能启动。')) }
    function onData(data) {
      output = (output + data).slice(-4096)
      if (output.includes('proxy listening at: 127.0.0.1:' + port)) finish()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', finish)
    child.once('exit', onExit)
  })
}

async function probeProxy(binary, proxy) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leyra-exit-'))
  let child
  let done
  try {
    const out = 'leyra-import-probe'
    const config = {mode:'rule', 'allow-lan':false, 'bind-address':'127.0.0.1',
      'log-level':'info', 'find-process-mode':'off', ipv6:true,
      proxies:[], 'proxy-groups':[], rules:['MATCH,REJECT']}
    const entries = [{id:'candidate', out, proxy:{...proxy,name:out}}]
    const context = addProbeAndGate(config,{entries},randomBytes(32))
    const file = path.join(temporary,'config.json')
    await fs.writeFile(file,JSON.stringify(config),{mode:0o600})
    child = spawn(binary,['-d',temporary,'-f',file],{stdio:['ignore','pipe','pipe'],windowsHide:true})
    done = once(child,'close').catch(()=>{})
    await waitForListener(child, context.probePort)
    child.stdout.resume()
    child.stderr.resume()
    let result = await readProbe(context,context.entries[0])
    if (!result.ip) {
      await delay(150)
      result = await readProbe(context,context.entries[0])
    }
    return result
  } finally {
    if (child) {
      child.kill()
      const force = setTimeout(()=>child.kill('SIGKILL'),600)
      await done
      clearTimeout(force)
    }
    await fs.rm(temporary,{recursive:true,force:true})
  }
}

const probeVless = (binary, node) => probeProxy(binary, makeProxy(node))
module.exports = {probeVless, probeProxy}
