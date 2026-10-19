import path from 'node:path';
import { createServer } from 'vite';

/** Keep the Studio development server from serving local credentials or CMS data. */
export async function createStudioDevServer(options: { root?: string; dataDir: string }) {
  const dataDir = path.resolve(options.dataDir).replaceAll('\\', '/');
  return createServer({
    ...(options.root ? { root: path.resolve(options.root) } : {}),
    server: {
      middlewareMode: true,
      cors: false,
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.credentials/**', '**/.data/**', `${dataDir}/**`],
      },
    },
    appType: 'spa',
  });
}
