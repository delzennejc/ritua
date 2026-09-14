import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
const directory = await mkdtemp(join(tmpdir(), 'ritua-profile-'))
try {
  const outfile = join(directory, 'profile.mjs')
  await build({
    entryPoints: ['src/tests/workspace-profile.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [outfile], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
} finally {
  await rm(directory, { recursive: true, force: true })
}
