import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';

test('API lifecycle: draft, conflicts, publication, real submissions, restore and export',async()=> {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'forma-http-'));
  process.env.FORMA_DATA_DIR=temp;
  const configuredPort=20000+Math.floor(Math.random()*20000);
  process.env.PORT=String(configuredPort); process.env.PREVIEW_PORT=String(configuredPort+1);
  const {createServers}=await import('../server/index.js');
  const {app,preview}=await createServers();
  let studio:Server|undefined; let site:Server|undefined;
  try {
    studio=app.listen(configuredPort,'127.0.0.1'); site=preview.listen(configuredPort+1,'127.0.0.1');
    await Promise.all([new Promise<void>(r=>studio!.once('listening',r)),new Promise<void>(r=>site!.once('listening',r))]);
    const port=(studio.address() as {port:number}).port; const sitePort=(site.address() as {port:number}).port;
    const request=async(url:string,method='GET',body?:unknown,headers:Record<string,string>={})=> {
      const response=await fetch(`http://127.0.0.1:${port}${url}`,{method,headers:{Host:`127.0.0.1:${configuredPort}`,'Content-Type':'application/json','X-Forma-Request':'studio',...headers},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,data:await response.json()};
    };
    let bootstrap=await request('/api/bootstrap'); assert.equal(bootstrap.status,200); assert.equal(bootstrap.data.auth.connected,false);
    assert.equal((await request('/api/chat','POST',{message:'Add a form',attachmentIds:[]})).status,401);
    assert.equal((await request('/api/templates/form','POST',{revision:1},{'X-Forma-Request':''})).status,403);
    const form=await request('/api/templates/form','POST',{revision:1}); assert.equal(form.status,200); assert.equal(form.data.project.revision,2);
    assert.equal((await request('/api/templates/form','POST',{revision:1})).status,409);
    const publish=await request('/api/publish','POST',{revision:2}); assert.equal(publish.status,200);
    assert.equal((await request('/api/publish','POST',{revision:2})).status,400);
    const page=await fetch(`http://127.0.0.1:${sitePort}/published`,{headers:{Host:`127.0.0.1:${configuredPort+1}`}}); const html=await page.text(); assert.equal(page.status,200);
    const token=html.match(/name="_formaToken"[^>]*value="([^"]+)"/)?.[1] || html.match(/value="([^"]+)"[^>]*name="_formaToken"/)?.[1]; assert.ok(token,'published form includes submission token');
    const content=JSON.parse(form.data.project.files['content.json']); const formId=content.sections.find((s:{type:string})=>s.type==='form').id;
    const submit=async(tokenValue:string)=>fetch(`http://127.0.0.1:${sitePort}/forms/${formId}`,{method:'POST',headers:{Host:`127.0.0.1:${configuredPort+1}`,Origin:`http://127.0.0.1:${configuredPort+1}`,'Content-Type':'application/json'},body:JSON.stringify({_formaToken:tokenValue,name:'Тест',email:'test@example.com',message:'Test submission'})});
    assert.equal((await submit('invalid')).status,403); assert.equal((await submit(token!)).status,201);
    bootstrap=await request('/api/bootstrap'); assert.equal(bootstrap.data.project.submissions.length,1);
    const invalid=await request('/api/files','PUT',{revision:2,files:{'script.js':'function ('}}); assert.equal(invalid.status,200); assert.equal(invalid.data.validation.valid,false);
    assert.equal((await request('/api/publish','POST',{revision:3})).status,400);
    const restore=await request(`/api/releases/${publish.data.release.id}/restore`,'POST',{revision:3}); assert.equal(restore.status,200); assert.equal(restore.data.project.revision,4); assert.equal(restore.data.project.publishedRevision,2);
    const integration=await request('/api/integrations','POST',{revision:4,integration:{id:'crm',name:'CRM',type:'webhook',enabled:false,endpoint:'https://crm.example/webhook'},secret:'never-expose-this-secret'});
    assert.equal(integration.status,200); assert.equal(integration.data.project.integrations[0].secretConfigured,true); assert.ok(!JSON.stringify(integration.data).includes('never-expose-this-secret'));
    const moved=await request('/api/integrations','POST',{revision:5,integration:{id:'crm',name:'CRM',type:'webhook',enabled:false,endpoint:'https://different.example/webhook'}}); assert.equal(moved.status,200); assert.equal(moved.data.project.integrations[0].secretConfigured,false);
    const archive=await fetch(`http://127.0.0.1:${port}/api/export?framework=nuxt`,{headers:{Host:`127.0.0.1:${configuredPort}`}}); assert.equal(archive.status,200); assert.equal(archive.headers.get('content-type'),'application/zip'); const zip=Buffer.from(await archive.arrayBuffer()); assert.equal(zip.readUInt32LE(0),0x04034b50);
    const state=await fs.readFile(path.join(temp,'project.json'),'utf8'); assert.ok(!state.includes('never-expose-this-secret'));
  } finally {
    await Promise.all([studio,site].filter(Boolean).map(server=>new Promise<void>(resolve=>server!.close(()=>resolve()))));
    await fs.rm(temp,{recursive:true,force:true});
  }
});
