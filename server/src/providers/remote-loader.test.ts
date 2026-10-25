import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import '../test-helpers.js'
import { INSTALL_CONFIG } from '../config.js'
import { profileScope } from '../profile-scope.js'
import { AppCache } from '../utils/cache.utils.js'
import { loadRemoteProviders } from './remote-loader.js'
import { meetsMinDango, parseRegistry, type RemoteProviderEntry } from './remote-types.js'

const moduleV1 = `export default () => ({
  name: 'test', search: async () => [], getEpisodes: async () => null,
  getStreamUrls: async () => null
})`

test('provider updates keep verified fallbacks, metadata, and offline startup working', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dango-providers-'))
  const originalRoot = INSTALL_CONFIG.ROOT
  INSTALL_CONFIG.ROOT = root
  let manifest: unknown
  let module = moduleV1
  let requests = 0
  const server = createServer((req, res) => {
    requests++
    res.setHeader('Content-Type', 'application/json')
    res.end(req.url === '/registry.json' ? JSON.stringify(manifest) : module)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const registryUrl = `http://127.0.0.1:${address.port}/registry.json`
  const cacheDir = path.join(root, 'remote-providers')
  const opts = { cache: new AppCache(), registryUrl }
  const v1: RemoteProviderEntry = {
    id: 'test',
    label: 'Test',
    version: '1.0.0',
    entry: './provider.mjs',
    mature: false,
    sha256: createHash('sha256').update(moduleV1).digest('hex'),
    proxy: { hosts: ['old.example'], referer: 'https://old.example' },
  }
  const publish = (entry: RemoteProviderEntry) => {
    manifest = { version: 1, providers: [entry] }
  }
  t.after(async () => {
    INSTALL_CONFIG.ROOT = originalRoot
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(root, { recursive: true, force: true })
  })

  publish(v1)
  const first = loadRemoteProviders(opts)
  assert.equal(loadRemoteProviders(opts), first, 'concurrent refreshes share the same load')
  const loaded = await first
  assert.equal(loaded.registryLoaded, true)
  assert.equal(loaded.catalog[0].loaded, true)
  assert.equal(requests, 2)
  assert.equal((await loadRemoteProviders(opts)).providers.test, loaded.providers.test)
  assert.equal(requests, 3, 'unchanged modules are not downloaded again')

  const v2 = { ...v1, version: '2.0.0', proxy: { hosts: ['new.example'] } }
  module = 'bad download'
  publish(v2)
  for (let i = 0; i < 2; i++) {
    const result = await loadRemoteProviders(opts)
    assert.equal(result.catalog[0].version, '1.0.0')
    assert.match(result.catalog[0].error!, /serving cached 1.0.0: sha256 mismatch/)
    assert.deepEqual(result.proxyRules, [v1.proxy])
    assert.equal(result.providers.test, loaded.providers.test)
  }
  const restarted = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
      const { INSTALL_CONFIG } = await import(${JSON.stringify(new URL('../config.ts', import.meta.url).href)});
      INSTALL_CONFIG.ROOT = ${JSON.stringify(root)};
      const { AppCache } = await import(${JSON.stringify(new URL('../utils/cache.utils.ts', import.meta.url).href)});
      const { loadRemoteProviders } = await import(${JSON.stringify(new URL('./remote-loader.ts', import.meta.url).href)});
      const result = await loadRemoteProviders({ cache: new AppCache(), registryUrl: ${JSON.stringify(path.join(root, 'missing.json'))} });
      console.log('RESULT:' + JSON.stringify(result.catalog));
    `,
    ],
    { encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'silent' } }
  )
  assert.equal(
    JSON.parse(
      restarted
        .split('\n')
        .find((line) => line.startsWith('RESULT:'))!
        .slice(7)
    )[0].version,
    '1.0.0',
    'restart uses the saved fallback'
  )

  publish({ ...v2, minDango: '999.0.0' })
  assert.match((await loadRemoteProviders(opts)).catalog[0].error!, /requires dango 999.0.0/)

  module = 'export default () => ({ name: "test" })'
  publish({ ...v2, sha256: createHash('sha256').update(module).digest('hex') })
  assert.match((await loadRemoteProviders(opts)).catalog[0].error!, /invalid provider shape/)

  const cachedRegistry = await fs.readFile(path.join(cacheDir, 'registry.json'), 'utf8')
  manifest = { version: 2, providers: 'invalid' }
  assert.equal((await loadRemoteProviders(opts)).catalog[0].version, '1.0.0')
  assert.equal(await fs.readFile(path.join(cacheDir, 'registry.json'), 'utf8'), cachedRegistry)

  module = moduleV1.replace("name: 'test'", "name: 'updated'")
  publish({ ...v2, sha256: createHash('sha256').update(module).digest('hex') })
  const updated = await loadRemoteProviders(opts)
  assert.equal(updated.catalog[0].version, '2.0.0')
  assert.equal(updated.providers.test.name, 'updated')
  assert.deepEqual(updated.proxyRules, [v2.proxy])
  assert.equal((await fs.readdir(cacheDir)).filter((file) => file.endsWith('.mjs')).length, 1)

  manifest = { version: 3, providers: [] }
  const removed = await loadRemoteProviders(opts)
  assert.equal(removed.registryLoaded, true)
  assert.deepEqual(removed.catalog, [])
  assert.deepEqual(removed.providers, {})
  assert.deepEqual(removed.proxyRules, [])
  assert.deepEqual(
    (await fs.readdir(cacheDir)).filter((file) => file.endsWith('.mjs')),
    []
  )

  const localOpts = { ...opts, registryUrl: pathToFileURL(path.join(root, 'missing.json')).href }
  assert.equal((await loadRemoteProviders(localOpts)).registryLoaded, true)
  await fs.rm(path.join(cacheDir, 'registry.json'))
  assert.equal((await loadRemoteProviders(localOpts)).registryLoaded, false)
})

test('legacy caches migrate into the shared installation cache during a profile refresh', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dango-provider-migration-'))
  const originalRoot = INSTALL_CONFIG.ROOT
  INSTALL_CONFIG.ROOT = root
  t.after(async () => {
    INSTALL_CONFIG.ROOT = originalRoot
    await fs.rm(root, { recursive: true, force: true })
  })
  const cacheDir = path.join(root, 'remote-providers')
  await fs.mkdir(cacheDir)
  const sha256 = createHash('sha256').update(moduleV1).digest('hex')
  const registry = {
    version: 1,
    providers: [{ id: 'test', label: 'Test', version: '1.0.0', entry: 'missing.mjs', sha256 }],
  }
  await fs.writeFile(path.join(cacheDir, 'registry.json'), JSON.stringify(registry))
  await fs.writeFile(path.join(cacheDir, 'test-1.0.0.mjs'), moduleV1)
  const result = await profileScope.run(
    { id: 'owner', root: path.join(root, 'profile'), env: {} },
    () =>
      loadRemoteProviders({ cache: new AppCache(), registryUrl: path.join(root, 'missing.json') })
  )
  assert.equal(result.catalog[0].loaded, true)
  assert.deepEqual(
    (await fs.readdir(cacheDir)).filter((file) => file.endsWith('.mjs')),
    [`test-1.0.0-${sha256}.mjs`]
  )
  assert.equal(
    await fs.stat(path.join(root, 'profile')).then(
      () => true,
      () => false
    ),
    false
  )
})

test('registry validates versions and compares minimum dango versions numerically', () => {
  assert.equal(meetsMinDango('3.10.0', '3.9.9'), true)
  assert.equal(meetsMinDango('3.8.0', '3.8.0'), true)
  assert.equal(meetsMinDango('3.8.0', '3.8.1'), false)
  assert.equal(meetsMinDango('3.8.0', '4.0.0'), false)
  const entry = { id: 'test', label: 'Test', version: '1.0.0', entry: 'test.mjs' }
  assert.equal(
    parseRegistry({ version: 1, providers: [{ ...entry, embedBase: 'https://embed.example' }] })
      .providers[0].kind,
    'tv'
  )
  for (const version of ['../../outside', '1.0', '1.0.0/other']) {
    assert.throws(
      () => parseRegistry({ version: 1, providers: [{ ...entry, version }] }),
      /version/
    )
  }
  assert.throws(
    () => parseRegistry({ version: 1, providers: [{ ...entry, minDango: 'latest' }] }),
    /minDango/
  )
  assert.throws(() => parseRegistry({ version: 1.5, providers: [] }), /version/)
})
