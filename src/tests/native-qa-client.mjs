import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Connect only to the isolated hidden app explicitly launched by `npm run qa -- start`. */
export async function connectNativeQa() {
  const session = JSON.parse(await readFile('build/qa/session.json', 'utf8'))
  assert.match(session.dataDirectory, /ritua-qa-/)
  const targets = await (await fetch(`http://127.0.0.1:${session.controlPort}/json/list`)).json()
  const target = targets.find((item) => item.type === 'page' && item.url.startsWith(session.origin))
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let serial = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = ({ data }) => {
    const result = JSON.parse(data)
    if (result.method === 'Runtime.exceptionThrown')
      errors.push(
        result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text,
      )
    const call = pending.get(result.id)
    if (!call) return
    pending.delete(result.id)
    if (result.error) call.reject(new Error(JSON.stringify(result.error)))
    else call.resolve(result.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const check = async (expression) => {
    for (let index = 0; index < 100; index++) {
      if (await evaluate(expression)) return
      await delay(50)
    }
    throw new Error(`Check failed: ${expression}`)
  }
  const shot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`build/qa/shots/${name}.png`, Buffer.from(result.data, 'base64'))
  }
  await send('Runtime.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return { session, send, evaluate, check, shot, errors, close: () => socket.close() }
}
