import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireInstanceLock, INSTANCE_LOCK_FILENAME } from '../server/instance.js'

test('simultaneous startup has exactly one owner; lock is private and release allows restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forma-instance-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const attempts = await Promise.allSettled([acquireInstanceLock(directory), acquireInstanceLock(directory)])
  const successful = attempts.filter((result): result is PromiseFulfilledResult<() => Promise<void>> => result.status === 'fulfilled')
  const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  assert.equal(successful.length, 1)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason.message, /Forma.*(?:запущена|заблокирован)/)
  const lockPath = path.join(directory, INSTANCE_LOCK_FILENAME)
  const record = JSON.parse(await readFile(lockPath, 'utf8'))
  assert.equal(record.pid, process.pid)
  assert.equal((await stat(lockPath)).mode & 0o777, 0o600)
  await successful[0].value()
  await successful[0].value() // Shutdown may receive more than one signal.
  await assert.rejects(stat(lockPath), { code: 'ENOENT' })
  const release = await acquireInstanceLock(directory)
  await release()
})

test('stale and malformed lockfiles are not automatically reclaimed', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forma-stale-instance-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const lockPath = path.join(directory, INSTANCE_LOCK_FILENAME)
  const stale = JSON.stringify({ version: 1, pid: 2147483647, nonce: 'old', createdAt: new Date(0).toISOString() })
  await writeFile(lockPath, stale, { mode: 0o600 })
  await assert.rejects(acquireInstanceLock(directory), /удалите файл/)
  assert.equal(await readFile(lockPath, 'utf8'), stale)
  await writeFile(lockPath, '{partial', { mode: 0o600 })
  await assert.rejects(acquireInstanceLock(directory), /удалите файл/)
  assert.equal(await readFile(lockPath, 'utf8'), '{partial')
})

test('a late release does not remove a replacement instance lock', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forma-replaced-instance-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const releaseOld = await acquireInstanceLock(directory)
  await unlink(path.join(directory, INSTANCE_LOCK_FILENAME))
  const releaseNew = await acquireInstanceLock(directory)
  const newRecord = await readFile(path.join(directory, INSTANCE_LOCK_FILENAME), 'utf8')
  await releaseOld()
  assert.equal(await readFile(path.join(directory, INSTANCE_LOCK_FILENAME), 'utf8'), newRecord)
  await releaseNew()
})
