import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import { acquireInstanceLock } from './instance.js';
import { DATA_DIR, ATTACHMENTS_DIR, atomicWrite, readProject, mutateProject, requireRevision, changesBetween, id, ensureData } from './store.js';
import { parseContent, validateFiles, validateIntegration, contentSchema } from './validation.js';
import { renderSite, exportSite } from './site.js';
import { getAuthStatus, startChatGPTLogin, finishChatGPTLogin, connectApiKey, disconnectAuth } from './auth.js';
import { runAgent } from './ai.js';
import { setIntegrationSecret, deliverWebhook, secretIdentity } from './integrations.js';
import { createZip } from './zip.js';
import type { Attachment, Integration, SiteFiles, Submission } from '../shared/types.js';

const STUDIO_PORT = Number(process.env.PORT || 4310);
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 4311);
const STUDIO_ORIGIN = `http://127.0.0.1:${STUDIO_PORT}`;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const controllers = new Map<string, AbortController>();
const allowedId = /^[a-zA-Z0-9_-]{1,90}$/;
const asyncRoute = (fn: (req: Request,res: Response) => Promise<unknown>) => (req: Request,res: Response,next: NextFunction) => { Promise.resolve(fn(req,res)).catch(next); };
function fail(message: string,status = 400): never { throw Object.assign(new Error(message), { status }); }

function localBoundary(app: express.Express, port: number) {
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return res.status(403).json({ error: 'Недопустимый адрес сервера' });
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    next();
  });
}
function studioMutation(req: Request,res: Response,next: NextFunction) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (req.header('X-Forma-Request') !== 'studio' || (req.header('origin') && req.header('origin') !== STUDIO_ORIGIN && req.header('origin') !== `http://localhost:${STUDIO_PORT}`)) return res.status(403).json({ error: 'Недопустимый источник запроса' });
  next();
}
function errors(error: unknown,_req: Request,res: Response,_next: NextFunction) {
  const e = error as Error & { status?: number; issues?: unknown; type?: string };
  res.status(e.status || (e.issues ? 400 : e.type === 'entity.too.large' ? 413 : 400)).json({ error: e.type === 'entity.too.large' ? 'Файл или запрос слишком большой' : e.message || 'Не удалось выполнить действие' });
}
async function formKey() {
  const filename=path.join(DATA_DIR,'forms.key');
  try { return await fs.readFile(filename); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const key=randomBytes(32); await atomicWrite(filename,key); return key; }
}
async function tokenFor(releaseId: string) { return createHmac('sha256',await formKey()).update(releaseId).digest('hex'); }

export async function createServers() {
  await ensureData(); await readProject(); await formKey();
  // A process restart must never leave a draft permanently locked by an orphan job.
  await mutateProject(project => { for(const run of project.runs) if(run.status === 'running') { run.status='failed'; run.stage='Выполнение прервано перезапуском сервера'; run.error=run.stage; run.completedAt=new Date().toISOString(); } });
  const app=express(); localBoundary(app,STUDIO_PORT); app.use('/api',studioMutation);
  app.post('/api/attachments',express.raw({ type: () => true,limit:'10mb' }),asyncRoute(async (req,res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail('Выберите файл для загрузки');
    const bytes=req.body as Buffer;
    let name=''; try { name=decodeURIComponent(req.header('X-File-Name') || 'file'); } catch { fail('Некорректное имя файла'); }
    name=path.basename(name).replace(/[\x00-\x1f]/g,'').slice(0,200);
    const ext=path.extname(name).toLowerCase();
    const mimeByExt: Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json'};
    const mime=mimeByExt[ext]; if(!mime) fail('Поддерживаются PNG, JPEG, WebP, PDF, TXT, Markdown, CSV и JSON');
    if(mime==='image/png' && bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') fail('Файл не является PNG');
    if(mime==='image/jpeg' && bytes.subarray(0,3).toString('hex')!=='ffd8ff') fail('Файл не является JPEG');
    if(mime==='image/webp' && (bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP')) fail('Файл не является WebP');
    if(mime==='application/pdf' && bytes.subarray(0,5).toString()!=='%PDF-') fail('Файл не является PDF');
    const attachmentId=id('file');
    const attachment: Attachment={id:attachmentId,name,mime,size:bytes.length,url:`${PREVIEW_ORIGIN}/assets/${attachmentId}`,createdAt:new Date().toISOString(),...(mime.startsWith('text/')||mime==='application/json'?{text:bytes.toString('utf8').slice(0,150000)}:{})};
    await mutateProject(async project => {
      if(project.attachments.length>=100) fail('Достигнут лимит 100 файлов. Удалите ненужные вложения.');
      if(project.attachments.reduce((n,a)=>n+a.size,0)+bytes.length>200*1024*1024) fail('Достигнут лимит хранилища 200 МБ');
      await atomicWrite(path.join(ATTACHMENTS_DIR,attachmentId),bytes); project.attachments.push(attachment);
    });
    res.status(201).json(attachment);
  }));
  app.use(express.json({limit:'3mb'}));
  app.get('/api/bootstrap',asyncRoute(async (_req,res) => { const project=await readProject(); res.json({project,auth:await getAuthStatus(),validation:validateFiles(project.files),previewUrl:`${PREVIEW_ORIGIN}/preview?revision=${project.revision}`,publishedUrl:`${PREVIEW_ORIGIN}/published`}); }));
  app.get('/api/auth/status',asyncRoute(async (_req,res)=>res.json(await getAuthStatus())));
  app.post('/api/auth/connect',asyncRoute(async (req,res)=> {
    if(req.body.provider==='chatgpt') res.json(await startChatGPTLogin(`${STUDIO_ORIGIN}/api/auth/callback`));
    else if(req.body.provider==='api-key') { if(typeof req.body.apiKey!=='string') fail('Укажите API-ключ'); res.json(await connectApiKey(req.body.apiKey,req.body.model)); }
    else fail('Выберите способ подключения');
  }));
  app.get('/api/auth/callback',asyncRoute(async (req,res)=> { const query=Object.fromEntries(Object.entries(req.query).filter((entry):entry is [string,string]=>typeof entry[1]==='string')); await finishChatGPTLogin(query,`${STUDIO_ORIGIN}/api/auth/callback`); res.redirect('/?connected=1'); }));
  app.post('/api/auth/disconnect',asyncRoute(async (_req,res)=> { if(controllers.size) fail('Остановите агента перед отключением аккаунта'); await disconnectAuth(); res.json({ok:true}); }));
  app.put('/api/content',asyncRoute(async (req,res)=> {
    const content=contentSchema.parse(req.body.content);
    const {project}=await mutateProject(p=> { requireRevision(p,req.body.revision); p.files['content.json']=JSON.stringify(content,null,2); p.revision++; });
    res.json({project,validation:validateFiles(project.files)});
  }));
  app.put('/api/files',asyncRoute(async (req,res)=> {
    const patch=req.body.files;
    if(!patch || typeof patch!=='object' || Array.isArray(patch) || !Object.keys(patch).length || Object.entries(patch).some(([k,v])=>!['content.json','styles.css','script.js'].includes(k)||typeof v!=='string'||v.length>500000)) fail('Недопустимые файлы');
    const {project}=await mutateProject(p=> { requireRevision(p,req.body.revision); p.files={...p.files,...patch}; p.revision++; });
    res.json({project,validation:validateFiles(project.files)});
  }));
  app.post('/api/templates/form',asyncRoute(async(req,res)=> {
    const {project}=await mutateProject(p=> { requireRevision(p,req.body.revision); const c=parseContent(p.files); c.sections.push({id:id('form'),type:'form',title:'Давайте обсудим ваш проект',subtitle:'Оставьте контакты — мы свяжемся с вами и ответим на вопросы.',buttonText:'Отправить заявку',fields:[{name:'name',label:'Ваше имя',type:'text',required:true},{name:'email',label:'Электронная почта',type:'email',required:true},{name:'message',label:'Расскажите о проекте',type:'textarea'}]}); p.files['content.json']=JSON.stringify(c,null,2); p.revision++; });
    res.json({project,validation:validateFiles(project.files)});
  }));
  app.post('/api/chat',asyncRoute(async(req,res)=> {
    const message=typeof req.body.message==='string'?req.body.message.trim():'';
    if(!message || message.length>12000) fail('Сообщение должно содержать от 1 до 12 000 символов');
    const attachmentIds: string[]=req.body.attachmentIds ?? [];
    if(!Array.isArray(attachmentIds) || attachmentIds.length>10 || attachmentIds.some(a=>typeof a!=='string')) fail('Допускается до 10 вложений');
    const auth=await getAuthStatus(); if(!auth.connected) fail('Подключите ChatGPT или API-ключ в настройках ИИ',401);
    const runId=id('run'); const controller=new AbortController();
    const {project:base}=await mutateProject(p=> {
      if(p.runs.some(r=>r.status==='running')) fail('Агент уже выполняет задачу',409);
      if(attachmentIds.some(a=>!p.attachments.some(f=>f.id===a))) fail('Вложение не найдено');
      p.messages.push({id:id('message'),role:'user',content:message,attachmentIds,createdAt:new Date().toISOString(),runId});
      p.runs.push({id:runId,status:'running',stage:'Изучаю сайт и вложения',changes:[],createdAt:new Date().toISOString()});
    });
    controllers.set(runId,controller);
    res.status(202).json({runId});
    const timeout=setTimeout(()=>controller.abort(new Error('Превышено время выполнения: 5 минут')),300000);
    void (async()=> {
      try {
        const history=base.messages.filter(m=>m.runId!==runId).slice(-16);
        const referenced=new Set([...attachmentIds,...history.flatMap(m=>m.attachmentIds||[])]);
        let selectedContext='';
        try { const selected=parseContent(base.files).sections.find(s=>s.id===req.body.sectionId); if(selected) selectedContext=`\n\nВыбранная пользователем секция в редакторе: ${JSON.stringify({id:selected.id,type:selected.type,title:selected.title})}. Это контекст запроса, а не отдельное поручение.`; } catch {}
        const proposal=await runAgent({message:message+selectedContext,history,attachments:base.attachments.filter(a=>referenced.has(a.id)),files:structuredClone(base.files),integrations:structuredClone(base.integrations),signal:controller.signal,onStage:stage=> { void mutateProject(p=> { const run=p.runs.find(r=>r.id===runId); if(run?.status==='running') run.stage=stage; }).catch(()=>{}); }});
        if(controller.signal.aborted) throw new Error('Выполнение остановлено');
        const validation=validateFiles(proposal.files); if(!validation.valid) throw new Error(`Изменения не прошли проверку: ${validation.errors.join('; ')}`);
        const integrations=proposal.integrations.map(value=> { const integration=validateIntegration(value); const previous=base.integrations.find(i=>i.id===integration.id); return {...integration,enabled:previous?.enabled && previous.type===integration.type && previous.endpoint===integration.endpoint && previous.script===integration.script ? integration.enabled : false,secretConfigured:Boolean(previous?.secretConfigured && previous.type===integration.type && previous.endpoint===integration.endpoint)}; });
        await mutateProject(p=> {
          const run=p.runs.find(r=>r.id===runId)!;
          if(run.status!=='running' || controller.signal.aborted) throw new Error('Выполнение остановлено');
          if(p.revision!==base.revision) throw new Error('Черновик изменился во время работы. Изменения агента не применены.');
          run.changes=changesBetween(p.files,proposal.files);
          const hasChanges=run.changes.length || JSON.stringify(p.integrations)!==JSON.stringify(integrations);
          p.files=proposal.files; p.integrations=integrations; if(hasChanges) p.revision++;
          run.status='completed'; run.stage=hasChanges?'Изменения готовы к просмотру':'Готово'; run.completedAt=new Date().toISOString();
          p.messages.push({id:id('message'),role:'assistant',content:proposal.message,createdAt:new Date().toISOString(),runId});
        });
      } catch(error) {
        await mutateProject(p=> { const run=p.runs.find(r=>r.id===runId)!; run.status=controller.signal.aborted?'cancelled':'failed'; run.error=controller.signal.aborted?'Выполнение остановлено. Черновик сохранён без изменений агента.':(error as Error).message; run.stage=run.error; run.completedAt=new Date().toISOString(); p.messages.push({id:id('message'),role:'assistant',content:run.error,createdAt:new Date().toISOString(),runId}); });
      } finally { clearTimeout(timeout); controllers.delete(runId); }
    })().catch(error=>console.error('Agent state update failed:',(error as Error).name));
  }));
  app.post('/api/runs/:id/cancel',asyncRoute(async(req,res)=> { await mutateProject(p=> { const run=p.runs.find(r=>r.id===req.params.id); const controller=controllers.get(String(req.params.id)); if(!controller || run?.status!=='running') fail('Задача уже завершена',409); controller.abort(); }); res.json({ok:true}); }));
  app.post('/api/publish',asyncRoute(async(req,res)=> {
    const {project,result:release}=await mutateProject(p=> { requireRevision(p,req.body.revision); const validation=validateFiles(p.files); if(!validation.valid) fail(validation.errors.join('; ')); for(const i of p.integrations) validateIntegration(i); if(p.publishedRevision===p.revision) fail('Эта версия уже опубликована'); const release={id:id('release'),label:String(req.body.label||`Версия ${p.releases.length+1}`).slice(0,150),createdAt:new Date().toISOString(),revision:p.revision,files:structuredClone(p.files),integrations:structuredClone(p.integrations)}; p.releases.push(release); p.publishedRevision=p.revision; return release; });
    res.json({project,release});
  }));
  app.post('/api/releases/:id/restore',asyncRoute(async(req,res)=> {
    const {project}=await mutateProject(p=> { requireRevision(p,req.body.revision); const release=p.releases.find(r=>r.id===req.params.id); if(!release) fail('Версия не найдена',404); p.files=structuredClone(release.files); p.integrations=structuredClone(release.integrations); p.revision++; }); res.json({project,validation:validateFiles(project.files)});
  }));
  app.post('/api/integrations',asyncRoute(async(req,res)=> {
    const integration=validateIntegration(req.body.integration);
    if(req.body.secret!==undefined && (typeof req.body.secret!=='string'||req.body.secret.length>8000)) fail('Недопустимый секрет');
    const {project}=await mutateProject(async p=> { requireRevision(p,req.body.revision); const old=p.integrations.find(i=>i.id===integration.id); const existing=p.integrations.filter(i=>i.id!==integration.id); if(existing.length>=20) fail('Допускается до 20 интеграций'); const secret=req.body.secret; if(secret!==undefined) await setIntegrationSecret(secretIdentity(integration),secret); p.integrations=[...existing,{...integration,secretConfigured:secret!==undefined?Boolean(secret):Boolean(old?.secretConfigured && old.endpoint===integration.endpoint && old.type===integration.type)}]; p.revision++; }); res.json({project});
  }));
  app.delete('/api/integrations/:id',asyncRoute(async(req,res)=> { const {project}=await mutateProject(p=> { requireRevision(p,req.body.revision); p.integrations=p.integrations.filter(i=>i.id!==req.params.id); p.revision++; }); res.json({project}); }));
  app.get('/api/attachments/:id/file',asyncRoute(async(req,res)=> { const p=await readProject(); const a=p.attachments.find(a=>a.id===req.params.id); if(!a) fail('Файл не найден',404); res.type(a.mime); res.setHeader('Content-Security-Policy',"sandbox"); res.send(await fs.readFile(path.join(ATTACHMENTS_DIR,a.id))); }));
  app.delete('/api/attachments/:id',asyncRoute(async(req,res)=> { const attachmentId=String(req.params.id); if(!allowedId.test(attachmentId)) fail('Файл не найден',404); await mutateProject(async p=> { if(p.runs.some(r=>r.status==='running')) fail('Дождитесь завершения агента',409); if(JSON.stringify(p.files).includes(attachmentId)||p.releases.some(r=>JSON.stringify(r.files).includes(attachmentId))) fail('Файл используется на сайте или в истории версий'); p.attachments=p.attachments.filter(a=>a.id!==attachmentId); for(const m of p.messages) m.attachmentIds=m.attachmentIds?.filter(a=>a!==attachmentId); await fs.rm(path.join(ATTACHMENTS_DIR,attachmentId),{force:true}); }); res.json({ok:true}); }));
  app.get('/api/export',asyncRoute(async(req,res)=> {
    const framework=req.query.framework; if(framework!=='nuxt'&&framework!=='next') fail('Выберите Nuxt или Next');
    const p=await readProject(); const validation=validateFiles(p.files); if(!validation.valid) fail('Исправьте ошибки исходников перед экспортом');
    const source=structuredClone(p.files); const assets:Record<string,Buffer>={};
    for(const a of p.attachments.filter(a=>a.mime.startsWith('image/'))) {
      if(Object.values(source).some(file=>file.includes(a.url))) { const local=`/media/${a.id}${path.extname(a.name).toLowerCase()}`; for(const key of Object.keys(source)) source[key]=source[key]!.replaceAll(a.url,local); assets[`public${local}`]=await fs.readFile(path.join(ATTACHMENTS_DIR,a.id)); }
    }
    const files=exportSite(source,framework,p.integrations); res.type('application/zip').setHeader('Content-Disposition',`attachment; filename="forma-site-${framework}.zip"`); res.send(createZip({...files,...assets}));
  }));
  app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint не найден'}));
  app.use(errors);

  const preview=express(); localBoundary(preview,PREVIEW_PORT); preview.use(express.json({limit:'64kb'})); preview.use(express.urlencoded({extended:false,limit:'64kb'}));
  preview.get('/preview',asyncRoute(async(_req,res)=> { const p=await readProject(); const v=validateFiles(p.files); if(!v.valid) return res.status(422).type('text').send(`Черновик содержит ошибки:\n${v.errors.join('\n')}`); res.setHeader('Content-Security-Policy',`sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors ${STUDIO_ORIGIN} http://localhost:${STUDIO_PORT}`); res.type('html').send(renderSite(p.files,{preview:true,integrations:p.integrations})); }));
  preview.get('/published',asyncRoute(async(_req,res)=> { const p=await readProject(); const release=p.releases.at(-1); if(!release) return res.status(404).type('text').send('Сайт ещё не опубликован. Откройте Forma и нажмите «Опубликовать».'); res.type('html').send(renderSite(release.files,{preview:false,integrations:release.integrations,formToken:await tokenFor(release.id)})); }));
  preview.get('/assets/:id',asyncRoute(async(req,res)=> { const p=await readProject(); const a=p.attachments.find(a=>a.id===req.params.id&&a.mime.startsWith('image/')); if(!a || ![p.files,...p.releases.map(r=>r.files)].some(files=>JSON.stringify(files).includes(a.id))) fail('Ресурс не используется на сайте',404); res.type(a.mime).send(await fs.readFile(path.join(ATTACHMENTS_DIR,a.id))); }));
  const submissionLimits=new Map<string,{count:number,reset:number}>();
  preview.post('/forms/:id',asyncRoute(async(req,res)=> {
    if(req.header('origin')!==PREVIEW_ORIGIN) fail('Отправка формы разрешена с опубликованного сайта',403);
    const p=await readProject(); const release=p.releases.at(-1); if(!release) fail('Сайт ещё не опубликован',404);
    const expected=await tokenFor(release.id); const token=String(req.body._formaToken||''); if(token.length!==expected.length || !timingSafeEqual(Buffer.from(token),Buffer.from(expected))) fail('Обновите страницу перед отправкой формы',403);
    const c=parseContent(release.files); const section=c.sections.find(s=>s.id===req.params.id&&s.type==='form'); if(!section) fail('Форма не найдена',404);
    const data:Record<string,string>=Object.create(null); for(const field of section.fields||[]) { const raw=Object.hasOwn(req.body,field.name)?req.body[field.name]:''; if(typeof raw!=='string') fail(`Недопустимое значение поля «${field.label}»`); const value=raw.trim(); if(value.length>5000) fail('Слишком длинное значение поля'); if(field.required&&!value) fail(`Заполните поле «${field.label}»`); if(field.type==='email'&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('Проверьте электронную почту'); data[field.name]=value; }
    const key=req.ip||'local'; const current=submissionLimits.get(key); const limit=current&&current.reset>Date.now()?current:{count:0,reset:Date.now()+3600000}; if(limit.count>=30) fail('Слишком много заявок. Попробуйте позже.',429); limit.count++; submissionLimits.set(key,limit);
    const submission:Submission={id:id('lead'),formId:section.id,data,createdAt:new Date().toISOString(),deliveries:[]};
    await mutateProject(project=> { project.submissions.push(submission); });
    res.status(201).json({ok:true,id:submission.id});
    void Promise.all(release.integrations.filter(i=>i.type==='webhook'&&i.enabled).map(async integration=> { let status='Ошибка доставки'; try { status=await deliverWebhook(integration,submission); } catch {} await mutateProject(project=> { const lead=project.submissions.find(s=>s.id===submission.id); lead?.deliveries?.push({integrationId:integration.id,status}); }); })).catch(()=>{});
  }));
  preview.use(errors);
  return {app,preview};
}

export async function start() {
  const release=await acquireInstanceLock(DATA_DIR);
  const servers:Server[]=[];
  let vite:import('vite').ViteDevServer|undefined;
  const stop=async()=> {
    for(const controller of controllers.values()) controller.abort();
    await Promise.all(servers.map(server=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})));
    await vite?.close();
    await release();
  };
  try {
    const {app,preview}=await createServers();
    if(process.env.NODE_ENV==='production') { app.use(express.static(path.resolve('dist'))); app.get('/{*path}',(_req,res)=>res.sendFile(path.resolve('dist/index.html'))); }
    else { const {createStudioDevServer}=await import('./dev.js'); vite=await createStudioDevServer({dataDir:DATA_DIR}); app.use(vite.middlewares); }
    for(const [handler,port] of [[app,STUDIO_PORT],[preview,PREVIEW_PORT]] as const) {
      const server=createHttpServer(handler); servers.push(server);
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    }
    console.log(`Forma Studio: ${STUDIO_ORIGIN}`);
    console.log(`Site preview: ${PREVIEW_ORIGIN}/preview`);
    const shutdown=()=>{void stop().then(()=>process.exit(0),()=>process.exit(1));};
    process.once('SIGTERM',shutdown); process.once('SIGINT',shutdown);
    return {stop};
  } catch(error) { await stop(); throw error; }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) start().catch(error=>{console.error(error.message);process.exit(1);});
