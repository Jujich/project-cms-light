import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

export const INSTANCE_LOCK_FILENAME = '.forma-instance.lock'
interface LockRecord { version: 1; pid: number; nonce: string; createdAt: string }

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

async function existingLockError(lockPath: string): Promise<Error> {
  let record: Partial<LockRecord> | undefined
  try { record = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockRecord> } catch { /* A partly written or unknown lock is still exclusive. */ }
  const pid = record && Number.isSafeInteger(record.pid) && Number(record.pid) > 0 ? Number(record.pid) : undefined
  if (pid && processExists(pid)) {
    return new Error(`Forma уже запущена с этим каталогом данных (процесс ${pid}). Остановите существующий экземпляр перед повторным запуском. Файл блокировки: ${lockPath}`)
  }
  return new Error(`Каталог данных Forma заблокирован${pid ? ` завершённым процессом ${pid}` : ''}. Убедитесь, что другой экземпляр Forma не работает, удалите файл ${lockPath} и запустите сервер снова.`)
}

/** Acquire before reading/recovering mutable project state. Stale locks require explicit removal. */
export async function acquireInstanceLock(dataDir: string): Promise<() => Promise<void>> {
  const directory = path.resolve(dataDir)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(directory, INSTANCE_LOCK_FILENAME)
  const record: LockRecord = { version: 1, pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() }
  let handle
  try { handle = await open(lockPath, 'wx', 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw await existingLockError(lockPath)
    throw error
  }
  try {
    await handle.writeFile(JSON.stringify(record))
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(lockPath).catch(() => {})
    throw error
  }
  await handle.close()

  let released = false
  return async () => {
    if (released) return
    released = true
    try {
      const current = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<LockRecord>
      // Do not delete a replacement lock after somebody manually removed ours.
      if (current.nonce === record.nonce && current.pid === record.pid) await unlink(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
