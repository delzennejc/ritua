import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve('src')
const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile() && /\.[jt]sx?$/.test(entry.name))
for (const entry of files) {
  const path = resolve(entry.parentPath, entry.name), name = relative(root, path)
  const text = await readFile(path, 'utf8')
  assert.ok(!name.includes('/prototype/'), `Production source must not live under prototype: ${name}`)
  const imports = [...text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1])
  for (const specifier of imports) {
    const target = specifier.startsWith('.') ? relative(root, resolve(entry.parentPath, specifier)) : specifier
    if (name.startsWith('renderer/')) assert.ok(!/^(main\/|tests\/)/.test(target) && !/mockData|sample-data|sample-workspace|prototype-seed/.test(target), `Renderer must not import native or fixture code: ${name} -> ${target}`)
    if (name.startsWith('domain/')) assert.ok(!/^(renderer\/|main\/|tests\/|electron$|better-sqlite3$|react$)/.test(target), `Domain must remain independent: ${name} -> ${target}`)
  }
}
console.log('PASS: renderer uses production data; domain has no renderer/native/test dependencies.')
