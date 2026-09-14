import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// Bundle only the test entry so Node can run extensionless TS imports without Electron.
const directory = await mkdtemp(join(tmpdir(), 'ritua-unit-'))
try {
  const outfile = join(directory, 'unit-tests.mjs')
  await build({
    entryPoints: ['src/tests/unit.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
  })
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--enable-source-maps', '--test', outfile], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  process.exitCode = code
} finally {
  await rm(directory, { recursive: true, force: true })
}
