import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import assert from 'node:assert/strict'
import { builtinModules } from 'node:module'
const root = resolve('src')
const nativePackages = new Set([
  'electron',
  'better-sqlite3',
  'drizzle-orm',
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
])
const packageName = (specifier) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.replace(/^node:/, '').split('/')[0]
const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(
  (entry) => entry.isFile() && /\.[jt]sx?$/.test(entry.name),
)
for (const entry of files) {
  const path = resolve(entry.parentPath, entry.name),
    name = relative(root, path)
  const text = await readFile(path, 'utf8')
  assert.ok(!name.includes('/prototype/'), `Production source must not live under prototype: ${name}`)
  if (name.startsWith('renderer/src/app/')) {
    assert.ok(
      !/useWorkspaceState\(\s*['"](?:tasks|datedTasksByDate|backlogGroups|events)['"]/.test(text),
      `Task views must use read-only projections: ${name}`,
    )
    assert.ok(
      !/\b(?:setTasks|setDatedTasksByDate|setBacklogGroups)\b/.test(text),
      `Task-list setters must not return to UI handlers: ${name}`,
    )
    assert.ok(!/state\.fields\b/.test(text), `Read projections from the canonical document: ${name}`)
    assert.ok(
      !/\breplaceWorkspaceFields\b/.test(text),
      `UI mutations must publish canonical documents: ${name}`,
    )
    assert.ok(
      !/\b(?:executeTaskCommand|editWorkspaceTask|deleteWorkspaceTask|changeWorkspaceRecurrence|updateCalendarSession)\(\s*getWorkspaceFields\(/.test(
        text,
      ),
      `Commands consume canonical documents: ${name}`,
    )
  }
  if (name === 'renderer/src/desktop/workspace-session.ts')
    assert.ok(
      !/\b(?:normalize|project|JSON.stringify)\(/.test(text),
      'The session must not round-trip or serialize whole workspaces for edits',
    )
  const imports = [
    ...text.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["']([^"']+)["']/g),
  ].map((match) => match[1])
  for (const specifier of imports) {
    const target = specifier.startsWith('.')
      ? relative(root, resolve(entry.parentPath, specifier))
      : specifier
    if (name.startsWith('renderer/'))
      assert.ok(
        !nativePackages.has(packageName(specifier)) &&
          !/^(main\/|tests\/)/.test(target) &&
          !/mockData|sample-data|sample-workspace|prototype-seed/.test(target),
        `Renderer must not import native or fixture code: ${name} -> ${target}`,
      )
    if (name.startsWith('domain/'))
      assert.ok(
        !nativePackages.has(packageName(specifier)) &&
          !['react', 'react-dom', 'zustand'].includes(packageName(specifier)) &&
          !/^(renderer\/|main\/|tests\/|electron$|better-sqlite3$|react$)/.test(target),
        `Domain must remain independent: ${name} -> ${target}`,
      )
  }
}
console.log('PASS: renderer uses production data; domain has no renderer/native/test dependencies.')

const nativeSource = await readFile(resolve(root, 'main/index.ts'), 'utf8')
assert.ok(
  !nativeSource.includes('ipcMain.handle('),
  'Register native commands through the sender-validating registrar',
)
