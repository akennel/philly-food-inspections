/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * `npm run dev` serves /api/* from ./data (written by `npm run backfill` + `npm run geocode`),
 * so you can browse local data without Netlify. Use `netlify dev` to run the real functions.
 */
function localDataApi(dataDir = 'data'): Plugin {
  const send = async (res: any, file: string) => {
    try {
      const body = await readFile(join(dataDir, file));
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    } catch {
      res.statusCode = file === 'index.json' ? 200 : 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(file === 'index.json' ? '[]' : JSON.stringify({ error: 'Not in local data' }));
    }
  };
  return {
    name: 'local-data-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/api/index') return send(res, 'index.json');
        const m = url.pathname.match(/^\/api\/facility\/([A-Fa-f0-9-]+)$/);
        if (m) return send(res, `facility/${m[1]}.json`);
        if (url.pathname === '/api/live-search') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ results: [], total: 0, note: 'Live search needs `netlify dev`' }));
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localDataApi()],
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
