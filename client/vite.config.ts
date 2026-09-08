import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import preact from '@preact/preset-vite'

export default defineConfig({
  // reactAliasesEnabled is off on purpose: `react` must resolve to our
  // local compat layer (preact/compat + `use`/`useOptimistic` polyfills
  // required by react-router v8), not to bare preact/compat.
  plugins: [preact({ reactAliasesEnabled: false })],
  resolve: {
    // `react` resolves to a local compat layer (preact/compat + React 19
    // `use`/`useOptimistic` polyfills required by react-router v8).
    // `prop-types` resolves to a no-op stub: react-simple-maps imports it
    // for legacy runtime checks, but this strict-TS project does not use it.
    alias: [
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL('./src/lib/preact-compat.js', import.meta.url)),
      },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
      {
        find: /^prop-types$/,
        replacement: fileURLToPath(new URL('./src/lib/prop-types-stub.ts', import.meta.url)),
      },
    ],
  },
  server: {
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
        configure(proxy) {
          const originalEmit = proxy.emit.bind(proxy)
          proxy.emit = ((event: string, ...args: unknown[]) => {
            if (event === 'error') {
              const [err, , res] = args as [NodeJS.ErrnoException, unknown, unknown]
              if (err?.code === 'ECONNREFUSED') {
                const r = res as import('http').ServerResponse | undefined
                if (r && typeof r.writeHead === 'function' && !r.headersSent) {
                  r.writeHead(503, { 'Content-Type': 'application/json' })
                  r.end(JSON.stringify({ error: 'Backend is starting up' }))
                }
                return false
              }
            }
            return (originalEmit as (...a: unknown[]) => boolean)(event, ...args)
          }) as typeof proxy.emit
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('preact') ||
              id.includes('react-router') ||
              id.includes('@tanstack/react-query')
            ) {
              return 'vendor'
            }
          }
        },
      },
    },
  },
})
