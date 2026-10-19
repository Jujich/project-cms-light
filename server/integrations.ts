import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { DATA_DIR, atomicWrite } from './store.js';
import type { Integration, Submission } from '../shared/types.js';

async function encryptionKey() {
  const p = path.join(DATA_DIR, 'secrets.key');
  try { return await fs.readFile(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const key = randomBytes(32); await atomicWrite(p, key); return key; }
}
export async function setIntegrationSecret(id: string, secret: string) {
  const key = await encryptionKey(); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  await atomicWrite(path.join(DATA_DIR, `secret-${id}.json`), JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
}
async function getIntegrationSecret(id: string) {
  try { const item = JSON.parse(await fs.readFile(path.join(DATA_DIR, `secret-${id}.json`), 'utf8')); const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), Buffer.from(item.iv, 'base64')); decipher.setAuthTag(Buffer.from(item.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; }
}
export function secretIdentity(integration: Integration) { return `${integration.id}-${createHash('sha256').update(`${integration.type}:${integration.endpoint || ''}`).digest('hex').slice(0,24)}`; }
export function isPublicAddress(address: string): boolean {
  if (address.includes(':')) return false; // MVP: IPv4 only, also rejects mapped private IPv6.
  const parts = address.split('.').map(Number); if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a,b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
}
export async function deliverWebhook(integration: Integration, submission: Submission): Promise<string> {
  if (!integration.endpoint) return 'Не настроен адрес';
  const url = new URL(integration.endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return 'Недопустимый адрес';
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return 'Внутренние адреса запрещены';
  const secret = await getIntegrationSecret(secretIdentity(integration));
  const body = JSON.stringify({ event: 'form.submitted', submission });
  return await new Promise(resolve => {
    const request = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, lookup: ((_hostname: unknown, options: {all?: boolean}, callback: (...args: unknown[]) => void) => { if(options?.all) callback(null, [{ address: addresses[0]!.address, family: 4 }]); else callback(null,addresses[0]!.address,4); }) as never, timeout: 8000 }, response => { response.resume(); resolve(response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? 'Доставлено' : `HTTP ${response.statusCode}`); });
    request.on('timeout', () => { request.destroy(); resolve('Превышено время ожидания'); });
    request.on('error', () => resolve('Ошибка соединения')); request.end(body);
  });
}
