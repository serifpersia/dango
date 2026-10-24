import assert from 'node:assert/strict'
import { test } from 'node:test'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { getRcloneService } from './rclone.js'
import logger from './logger.js'

test('missing Rclone is quietly unavailable, while other failures still warn', async (t) => {
  let error = Object.assign(new Error('spawn rclone ENOENT'), { code: 'ENOENT' })
  const exec = t.mock.method(childProcess, 'execFile', ((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void
    queueMicrotask(() => callback(error, '', ''))
  }) as unknown as typeof childProcess.execFile)
  syncBuiltinESMExports()
  const warn = t.mock.method(logger, 'warn', () => {})
  try {
    const service = getRcloneService()
    assert.equal(await service.init(), false)
    assert.equal(service.isActive(), false)
    assert.deepEqual(await service.listRemotes(), [])
    assert.equal(warn.mock.callCount(), 0)

    error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    assert.equal(await service.init(), false)
    assert.equal(warn.mock.callCount(), 1)
    assert.equal((warn.mock.calls[0].arguments[0] as { err: Error }).err, error)
  } finally {
    exec.mock.restore()
    syncBuiltinESMExports()
  }
})
