import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateFiles } from '../server/validation.js';
import { seedFiles } from '../server/site.js';
import { isPublicAddress, secretIdentity } from '../server/integrations.js';
import { createZip } from '../server/zip.js';

test('content schema rejects duplicate sections and invalid forms',()=> {
  const files=seedFiles(); const c=JSON.parse(files['content.json']); c.sections.push(c.sections[0]); files['content.json']=JSON.stringify(c); assert.equal(validateFiles(files).valid,false);
  c.sections.pop(); c.sections.push({id:'empty',type:'form',title:'Empty',fields:[]}); files['content.json']=JSON.stringify(c); assert.equal(validateFiles(files).valid,false);
});
test('JS syntax is checked without executing source',()=> {
  const files=seedFiles(); files['script.js']='throw new Error("must never execute")'; assert.equal(validateFiles(files).valid,true);
  files['script.js']='function ('; assert.equal(validateFiles(files).valid,false);
});
test('agent files cannot escape the site source contract',()=> {
  const files=seedFiles(); files['../../.env']='PRIVATE'; assert.equal(validateFiles(files).valid,false);
});
test('webhooks cannot reach local or reserved addresses',()=> {
  for(const ip of ['127.0.0.1','10.0.1.1','192.168.1.1','169.254.169.254','172.16.3.1','::1','::ffff:127.0.0.1','0.0.0.0','100.64.1.1']) assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);
});
test('secret identity is bound to the integration destination',()=> {
  const i={id:'crm',type:'webhook' as const,name:'CRM',enabled:true,endpoint:'https://crm.example/one'};
  assert.notEqual(secretIdentity(i),secretIdentity({...i,endpoint:'https://attacker.example/two'}));
});
test('ZIP emits a valid archive and rejects traversal filenames',async()=> {
  const zip=createZip({'hello.txt':'Привет','public/photo.bin':Buffer.from([0,1,2,255])});
  assert.equal(zip.readUInt32LE(0),0x04034b50); assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  assert.throws(()=>createZip({'../outside':'bad'}));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'forma-zip-')); try { await fs.writeFile(path.join(temp,'test.zip'),zip); } finally { await fs.rm(temp,{recursive:true,force:true}); }
});
