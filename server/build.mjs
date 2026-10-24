import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
rmSync(join(root, 'dist'), { recursive: true, force: true })

await build({
  entryPoints: [join(root, 'src', 'server.ts')],
  outfile: join(root, 'dist', 'server.js'),
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: true,
  minify: true,
  external: ['got-scraping'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
})

await build({
  entryPoints: [
    join(root, 'src', 'shipped-defaults.ts'),
    join(root, 'src', 'config.ts'),
    join(root, 'src', 'profile-scope.ts'),
  ],
  outdir: join(root, 'dist'),
  outbase: join(root, 'src'),
  platform: 'node',
  format: 'esm',
  target: 'node22',
  bundle: false,
  minify: true,
})

console.log('esbuild: bundled server.js + emitted shipped-defaults & config → dist/')
