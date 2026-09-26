#!/usr/bin/env node
// Hidden Electron QA: a real development instance with an isolated database, controlled over
// the DevTools protocol and captured without showing a window. See docs/verification.md.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stateDirectory = join(root, 'build', 'qa')
const sessionFile = join(stateDirectory, 'session.json')
const shotsDirectory = join(stateDirectory, 'shots')
const logFile = join(stateDirectory, 'electron.log')
const defaultControlPort = 9333
const defaultRendererPort = 5176

const usage = `Hidden Electron QA

Usage:
  npm run qa -- start [--control-port <port>] [--renderer-port <port>]
  npm run qa -- shot <name> [--script @file] [--size 1280x800] [--scale 2] [--full] [--reload] [--wait "text"]
  npm run qa -- eval <expression|@file>
  npm run qa -- reload
  npm run qa -- status
  npm run qa -- stop

The session runs \`electron-vite dev\` in its own output directory and renderer port. The window
stays hidden, the database lives in a temporary directory, and screenshots are written to
${shotsDirectory}. Ports are chosen automatically, so several worktrees can run QA at the same
time; pass --control-port or --renderer-port to pin them.`

class Cdp {
  static async connect(webSocketDebuggerUrl) {
    if (typeof WebSocket === 'undefined')
      throw new Error('This Node version has no WebSocket client. Use Node 22.13 or newer.')
    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true })
      socket.addEventListener('error', () => reject(new Error('Could not open the debugger socket.')), {
        once: true,
      })
    })
    return new Cdp(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message))
        else entry.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) entry.reject(new Error('The debugger socket closed.'))
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  close() {
    this.socket.close()
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'shot'

async function readSession() {
  try {
    return JSON.parse(await readFile(sessionFile, 'utf8'))
  } catch {
    return null
  }
}

async function ensureSession() {
  const session = await readSession()
  if (!session || !alive(session.pid))
    throw new Error('No QA session is running. Start one with: npm run qa -- start')
  return session
}

async function portFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.once('error', () => resolvePromise(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)))
  })
}

async function freePort(start) {
  for (let port = start; port < start + 100; port++) if (await portFree(port)) return port
  throw new Error(`No free port between ${start} and ${start + 100}.`)
}

async function logTail(lines = 30) {
  const content = await readFile(logFile, 'utf8').catch(() => '')
  return content.trimEnd().split('\n').slice(-lines).join('\n')
}

async function cdpVersion(port, timeout = 1500) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) throw new Error(`The debugger responded ${response.status}.`)
  return response.json()
}

async function listTargets(session) {
  const response = await fetch(`http://127.0.0.1:${session.controlPort}/json/list`, {
    signal: AbortSignal.timeout(1500),
  })
  if (!response.ok) throw new Error(`The target list responded ${response.status}.`)
  return response.json()
}

async function pageTarget(session) {
  const pages = (await listTargets(session)).filter((target) => target.type === 'page')
  return (
    pages.find((target) => target.url.startsWith(session.origin)) ??
    pages.find((target) => !target.url.startsWith('devtools://'))
  )
}

async function connect(session) {
  const target = await pageTarget(session)
  if (!target?.webSocketDebuggerUrl)
    throw new Error('No renderer page target is available. Is the session still starting?')
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  // Keep focus and blur behavior real for the hidden window while the application stays inactive.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return cdp
}

async function evaluate(cdp, expression, options = {}) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise ?? true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
    throw new Error(detail)
  }
  return response.result
}

async function scriptSource(input) {
  return input.startsWith('@') ? await readFile(resolve(input.slice(1)), 'utf8') : input
}

async function waitForReady(cdp, options) {
  const deadline = Date.now() + (options.timeout ?? 20000)
  const condition = options.wait
    ? `document.body && document.body.innerText.includes(${JSON.stringify(options.wait)})`
    : 'true'
  const expression = `(async () => {
    if (document.readyState !== 'complete') return false
    if (document.fonts && document.fonts.status !== 'loaded') return false
    return Boolean(${condition})
  })()`
  for (;;) {
    const result = await evaluate(cdp, expression).catch(() => undefined)
    if (result?.value) return
    if (Date.now() > deadline)
      throw new Error(
        options.wait
          ? `Timed out waiting for ${JSON.stringify(options.wait)} in the renderer.`
          : 'Timed out waiting for the renderer.',
      )
    await delay(200)
  }
}

async function waitForExit(pid, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await delay(150)
  }
  return !alive(pid)
}

async function start(options) {
  const current = await readSession()
  if (current && alive(current.pid)) {
    console.log(`A QA session is already running (pid ${current.pid}). Stop it first or reuse it.`)
    return
  }
  const controlPort = options.controlPort ?? (await freePort(defaultControlPort))
  const rendererPort = options.rendererPort ?? (await freePort(defaultRendererPort))
  if (options.controlPort && !(await portFree(controlPort)))
    throw new Error(`Control port ${controlPort} is in use.`)
  if (options.rendererPort && !(await portFree(rendererPort)))
    throw new Error(`Renderer port ${rendererPort} is in use.`)
  await mkdir(shotsDirectory, { recursive: true })
  const dataDirectory = await mkdtemp(join(tmpdir(), 'ritua-qa-'))
  const log = await open(logFile, 'w')
  const env = {
    ...process.env,
    RITUA_TEST_MODE: '1',
    RITUA_DATA_DIR: dataDirectory,
    RITUA_QA_MODE: '1',
    RITUA_RENDERER_PORT: String(rendererPort),
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const child = spawn(
    join(root, 'node_modules', '.bin', 'electron-vite'),
    ['dev', '--outDir', join('build', 'qa', 'out'), '--remoteDebuggingPort', String(controlPort)],
    { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] },
  )
  child.unref()
  let stopped
  child.on('error', (error) => {
    stopped = error.message
  })
  child.on('exit', (code) => {
    stopped = stopped ?? `exit ${code}`
  })
  await log.close()
  try {
    const deadline = Date.now() + (options.timeout ?? 90000)
    while (!(await cdpVersion(controlPort).catch(() => undefined))) {
      if (stopped) throw new Error(`electron-vite stopped early: ${stopped}`)
      if (Date.now() > deadline) throw new Error('Timed out waiting for the debugger.')
      await delay(250)
    }
    const session = {
      pid: child.pid,
      controlPort,
      rendererPort,
      origin: `http://127.0.0.1:${rendererPort}`,
      dataDirectory,
      shots: shotsDirectory,
      log: logFile,
      startedAt: new Date().toISOString(),
    }
    while (!(await pageTarget(session).catch(() => undefined))) {
      if (stopped) throw new Error(`electron-vite stopped early: ${stopped}`)
      if (Date.now() > deadline) throw new Error('Timed out waiting for the renderer page.')
      await delay(200)
    }
    await writeFile(sessionFile, JSON.stringify(session, null, 2) + '\n')
    console.log(`QA session started (pid ${child.pid}).`)
    console.log(`  renderer  ${session.origin}`)
    console.log(`  debugger  http://127.0.0.1:${controlPort}`)
    console.log(`  data      ${dataDirectory}`)
    console.log(`  shots     ${shotsDirectory}`)
    console.log(`  log       ${logFile}`)
    console.log('Stop with: npm run qa -- stop')
  } catch (error) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
    await rm(dataDirectory, { recursive: true, force: true })
    throw new Error(`${error.message}\n--- electron-vite log ---\n${await logTail()}`)
  }
}

async function stop() {
  const session = await readSession()
  if (!session) {
    console.log('No QA session.')
    return
  }
  if (alive(session.pid)) {
    try {
      const version = await cdpVersion(session.controlPort)
      const cdp = await Cdp.connect(version.webSocketDebuggerUrl)
      await cdp.send('Browser.close').catch(() => {})
      cdp.close()
    } catch {}
    if (!(await waitForExit(session.pid, 5000))) {
      try {
        process.kill(-session.pid, 'SIGTERM')
      } catch {}
      if (!(await waitForExit(session.pid, 3000))) {
        try {
          process.kill(-session.pid, 'SIGKILL')
        } catch {}
        await waitForExit(session.pid, 2000)
      }
    }
  }
  await rm(session.dataDirectory, { recursive: true, force: true })
  await rm(sessionFile, { force: true })
  console.log(`QA session stopped. Screenshots stay in ${shotsDirectory}.`)
}

async function status() {
  const session = await readSession()
  if (!session) {
    console.log('No QA session.')
    return
  }
  console.log(`pid       ${session.pid} (${alive(session.pid) ? 'running' : 'not running'})`)
  console.log(`renderer  ${session.origin}`)
  console.log(`data      ${session.dataDirectory}`)
  console.log(`shots     ${session.shots}`)
  if (!alive(session.pid)) return
  try {
    const version = await cdpVersion(session.controlPort)
    console.log(`debugger  ${version.Browser}`)
    for (const target of await listTargets(session)) console.log(`target    ${target.type} ${target.url}`)
  } catch (error) {
    console.log(`debugger unavailable: ${error.message}`)
  }
}

async function shot(name, options) {
  if (!name) throw new Error('Name a screenshot: npm run qa -- shot <name> [--script @file]')
  const session = await ensureSession()
  const cdp = await connect(session)
  const messages = []
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'warning' && params.type !== 'error') return
    const values = params.args.map((argument) => argument.value ?? argument.description ?? argument.type)
    messages.push(`${params.type}: ${values.join(' ')}`)
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    const detail = params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text
    messages.push(`exception: ${detail ?? 'unknown'}`)
  })
  try {
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    if (options.size) {
      const [width, height] = options.size.split('x').map(Number)
      if (!width || !height) throw new Error('Use --size 1280x800.')
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: options.scale ?? 2,
        mobile: false,
      })
    } else if (options.scale) {
      const width = (await evaluate(cdp, 'innerWidth')).value
      const height = (await evaluate(cdp, 'innerHeight')).value
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: options.scale,
        mobile: false,
      })
    }
    if (options.reload) {
      await cdp.send('Page.reload')
      await waitForReady(cdp, {})
    }
    if (options.script) await evaluate(cdp, await scriptSource(options.script))
    await waitForReady(cdp, options)
    const capture = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: Boolean(options.full),
    })
    await mkdir(shotsDirectory, { recursive: true })
    const filename = join(shotsDirectory, `${stamp()}-${slug(name)}.png`)
    await writeFile(filename, Buffer.from(capture.data, 'base64'))
    console.log(`SHOT ${filename}`)
    for (const message of [...new Set(messages)]) console.log(`CONSOLE ${message}`)
  } finally {
    cdp.close()
  }
}

async function evaluateCommand(input) {
  if (!input) throw new Error('Provide an expression or @file: npm run qa -- eval "document.title"')
  const session = await ensureSession()
  const cdp = await connect(session)
  try {
    await cdp.send('Runtime.enable')
    const result = await evaluate(cdp, await scriptSource(input))
    if ('value' in result) console.log(JSON.stringify(result.value, null, 2))
    else console.log(result.description ?? result.type)
  } finally {
    cdp.close()
  }
}

async function reload() {
  const session = await ensureSession()
  const cdp = await connect(session)
  try {
    await cdp.send('Page.enable')
    await cdp.send('Page.reload')
    await waitForReady(cdp, { timeout: 30000 })
    console.log(`Reloaded ${(await evaluate(cdp, 'location.href')).value}`)
  } finally {
    cdp.close()
  }
}

function parseArguments(args) {
  const options = {}
  const positional = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    const value = () => {
      const next = args[++index]
      if (next === undefined) throw new Error(`Missing value after ${argument}.`)
      return next
    }
    if (argument === '--full') options.full = true
    else if (argument === '--reload') options.reload = true
    else if (argument === '--wait') options.wait = value()
    else if (argument === '--script') options.script = value()
    else if (argument === '--size') options.size = value()
    else if (argument === '--scale') options.scale = Number(value())
    else if (argument === '--timeout') options.timeout = Number(value())
    else if (argument === '--control-port') options.controlPort = Number(value())
    else if (argument === '--renderer-port') options.rendererPort = Number(value())
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}.`)
    else positional.push(argument)
  }
  return { options, positional }
}

const [command, ...rest] = process.argv.slice(2)
try {
  const { options, positional } = parseArguments(rest)
  if (!command || command === 'help' || command === '--help' || command === '-h') console.log(usage)
  else if (command === 'start') await start(options)
  else if (command === 'stop') await stop()
  else if (command === 'status') await status()
  else if (command === 'shot') await shot(positional[0], options)
  else if (command === 'eval') await evaluateCommand(positional[0])
  else if (command === 'reload') await reload()
  else throw new Error(`Unknown command ${command}.\n\n${usage}`)
} catch (error) {
  console.error(`QA error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
