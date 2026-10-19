import { z } from 'zod';
import vm from 'node:vm';
import type { Integration, SiteContent, SiteFiles, Validation } from '../shared/types.js';

const string = z.string().max(30000);
const sectionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  type: z.enum(['hero', 'services', 'text', 'form', 'custom']),
  title: string, subtitle: string.optional(), body: string.optional(),
  buttonText: string.optional(), buttonUrl: string.optional(), image: string.optional(),
  items: z.array(z.object({ id: z.string().min(1).max(80), title: string, text: string })).max(100).optional(),
  fields: z.array(z.object({ name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/), label: z.string().min(1).max(200), type: z.enum(['text','email','tel','textarea']), required: z.boolean().optional() })).max(20).optional(),
  html: z.string().max(100000).optional(),
});
export const contentSchema = z.object({ name: z.string().min(1).max(120), description: string, title: string, accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), email: z.string().max(200), phone: z.string().max(100), sections: z.array(sectionSchema).min(1).max(80) });
export function parseContent(files: SiteFiles): SiteContent { return contentSchema.parse(JSON.parse(files['content.json'])) as SiteContent; }
export function validateFiles(files: SiteFiles): Validation {
  const errors: string[] = []; const warnings: string[] = [];
  for (const name of ['content.json','styles.css','script.js']) if (typeof files[name] !== 'string') errors.push(`Отсутствует файл ${name}`);
  for (const [name, value] of Object.entries(files)) {
    if (!['content.json','styles.css','script.js'].includes(name)) errors.push(`Файл ${name} не входит в поддерживаемые исходники MVP`);
    if (typeof value !== 'string' || value.length > 500000) errors.push(`Некорректный размер файла ${name}`);
  }
  try {
    const content = parseContent(files); const ids = new Set<string>();
    for (const s of content.sections) {
      if (ids.has(s.id)) errors.push(`Повторяется идентификатор секции ${s.id}`); ids.add(s.id);
      if (s.type === 'form') {
        if (!s.fields?.length) errors.push(`В форме «${s.title}» нет полей`);
        const names = s.fields?.map(f => f.name) || [];
        if (new Set(names).size !== names.length) errors.push(`Повторяются имена полей формы «${s.title}»`);
      }
      for (const url of [s.buttonUrl, s.image].filter(Boolean) as string[]) if (/^\s*(javascript|vbscript|data):/i.test(url)) errors.push(`Недопустимая ссылка в секции «${s.title}»`);
      if (s.type === 'custom') warnings.push(`Произвольная разметка: «${s.title}». Проверьте её на сайте.`);
    }
  } catch (error) { errors.push(error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : 'content.json содержит некорректный JSON'); }
  if (files['script.js']?.trim()) {
    try { new vm.Script(files['script.js']); } catch (error) { errors.push(`Ошибка JavaScript: ${(error as Error).message}`); }
    warnings.push('Пользовательский JavaScript выполняется на сайте. Проверьте поведение до публикации.');
  }
  if (/@import\b|url\(\s*['"]?https?:/i.test(files['styles.css'] || '')) warnings.push('CSS использует внешние ресурсы.');
  return { valid: errors.length === 0, errors, warnings };
}
export function validateIntegration(value: unknown): Integration {
  const integration = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), type: z.enum(['webhook','script']), name: z.string().min(1).max(120), enabled: z.boolean(), endpoint: z.string().max(2000).optional(), script: z.string().max(50000).optional(), secretConfigured: z.boolean().optional() }).parse(value);
  if (integration.type === 'webhook' && integration.endpoint) {
    const url = new URL(integration.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Для webhook нужен HTTPS URL без логина и пароля');
  }
  if (integration.type === 'webhook' && integration.enabled && !integration.endpoint) throw new Error('Укажите адрес webhook');
  if (integration.type === 'script' && integration.script) new vm.Script(integration.script);
  return integration;
}
