import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
let url = null
if (process.env.RITUA_UPDATE_URL) {
  const parsed = new URL(process.env.RITUA_UPDATE_URL)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
    throw new Error('RITUA_UPDATE_URL must be an HTTPS URL without credentials or a fragment')
  if (process.env.RITUA_SIGNED_RELEASE !== '1')
    throw new Error(
      'A public update channel requires RITUA_SIGNED_RELEASE=1 and valid Apple signing/notarization credentials',
    )
  url = parsed.href
}
await mkdir(resolve(root, 'build'), { recursive: true })
await writeFile(resolve(root, 'build/release-channel.json'), JSON.stringify({ url }, null, 2) + '\n')
const config = {
  extends: resolve(root, 'electron-builder.yml'),
  directories: { output: 'release-staging' },
  ...(url
    ? { forceCodeSigning: true, mac: { notarize: true }, publish: [{ provider: 'generic', url }] }
    : {}),
}
const configFile = resolve(root, 'build/packaging.generated.json')
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n')
const env = { ...process.env, ...(!url ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : {}) }
for (const [command, args] of [
  ['npm', ['run', 'build']],
  [
    process.execPath,
    [
      require.resolve('electron-builder/cli.js'),
      '--mac',
      'dmg',
      'zip',
      '--arm64',
      '--publish',
      'never',
      '--config',
      configFile,
    ],
  ],
]) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
console.log(`Built Ritua ${pkg.version}. Publishing is a separate explicit step.`)
