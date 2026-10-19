import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, SiteFiles, Change } from '../shared/types.js';
import { seedFiles } from './site.js';

export const DATA_DIR = path.resolve(process.env.FORMA_DATA_DIR || '.data');
export const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
let queue: Promise<unknown> = Promise.resolve();
export function id(prefix: string) { return `${prefix}_${randomUUID().replaceAll('-','')}`; }
export async function ensureData() { await fs.mkdir(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 }); }
export async function atomicWrite(file: string, value: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, file);
}
export async function readProject(): Promise<Project> {
  await ensureData();
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, 'project.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const files = seedFiles(); const now = new Date().toISOString();
    const project: Project = { id: 'site_liniya', name: 'Студия Линия', revision: 1, publishedRevision: 0, files, integrations: [], messages: [], attachments: [], runs: [], releases: [], submissions: [], updatedAt: now };
    await atomicWrite(path.join(DATA_DIR, 'project.json'), JSON.stringify(project, null, 2));
    return project;
  }
}
export function mutateProject<T>(fn: (project: Project) => T | Promise<T>): Promise<{ project: Project; result: T }> {
  const job = queue.then(async () => { const project = await readProject(); const result = await fn(project); project.updatedAt = new Date().toISOString(); await atomicWrite(path.join(DATA_DIR, 'project.json'), JSON.stringify(project, null, 2)); return { project, result }; });
  queue = job.catch(() => {}); return job;
}
export function requireRevision(project: Project, expected: unknown) {
  if (expected !== project.revision) throw Object.assign(new Error('Черновик уже изменился. Обновите страницу и повторите действие.'), { status: 409 });
  if (project.runs.some(r => r.status === 'running')) throw Object.assign(new Error('Агент сейчас изменяет сайт. Дождитесь завершения или остановите его.'), { status: 409 });
}
export function changesBetween(before: SiteFiles, after: SiteFiles): Change[] { return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).map(p => ({ path: p, before: before[p] || '', after: after[p] || '' })); }
