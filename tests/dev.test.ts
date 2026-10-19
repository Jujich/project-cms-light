import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createStudioDevServer } from '../server/dev.js';

test('Studio dev server serves the app without exposing private files or allowing preview CORS', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forma-dev-security-'));
  const dataDir = path.join(root, 'custom-runtime');
  const secret = 'fixture-private-marker-must-never-be-served';
  const privateFiles = [
    '.credentials/token.txt', '.data/private.json', '.git/config',
    '.env', '.env.local', 'server.pem', 'certificate.crt', 'custom-runtime/submissions.json',
  ];
  let server: Server | undefined;
  let vite: Awaited<ReturnType<typeof createStudioDevServer>> | undefined;
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"forma-dev-security-fixture","private":true}');
    await fs.writeFile(path.join(root, 'vite.config.mjs'), 'export default { logLevel: "silent", server: { ws: false } };');
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><main>Public Studio fixture</main></body></html>');
    await fs.writeFile(path.join(root, 'readable.txt'), 'ordinary-public-source');
    for (const file of privateFiles) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), secret);
    }
    vite = await createStudioDevServer({ root, dataDir });
    server = createServer((req, res) => vite!.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found'); }));
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const port = (server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;
    const home = await fetch(origin + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Public Studio fixture/);
    for (const requestPath of ['/readable.txt', '/@fs/' + path.join(root, 'readable.txt')]) {
      const response = await fetch(origin + requestPath);
      assert.equal(response.status, 200, 'the fixture is otherwise inside Vite’s serving allow list');
      assert.equal(await response.text(), 'ordinary-public-source');
    }

    for (const file of privateFiles) {
      const absolute = path.join(root, file).replaceAll('\\', '/');
      for (const requestPath of ['/' + file, '/@fs/' + absolute]) {
        const response = await fetch(origin + requestPath);
        assert.equal(response.status, 403, `private file must be denied: ${requestPath}`);
        assert.ok(!(await response.text()).includes(secret), `private bytes leaked: ${requestPath}`);
      }
    }

    for (const requestOrigin of ['http://127.0.0.1:4311', 'http://localhost:4311']) {
      const response = await fetch(origin + '/', { headers: { Origin: requestOrigin } });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      const preflight = await fetch(origin + '/', { method: 'OPTIONS', headers: { Origin: requestOrigin, 'Access-Control-Request-Method': 'GET' } });
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    }
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (vite) await vite.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
