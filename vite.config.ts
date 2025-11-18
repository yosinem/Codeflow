import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fetchGitHubPayload } from './server/githubImport.js';
import type { GitHubProxyPayload, GitHubProxyRateLimit } from './server/githubImport.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'github-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/github')) {
            next();
            return;
          }

          const url = new URL(req.url, 'http://localhost');
          const target = url.searchParams.get('url');
          res.setHeader('Content-Type', 'application/json');

          if (!target) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
          }

          try {
            const payload: GitHubProxyPayload = await fetchGitHubPayload(target);
            res.statusCode = 200;
            res.end(JSON.stringify(payload));
          } catch (error) {
            const err = error as { status?: number; message?: string; rateLimit?: GitHubProxyRateLimit | null };
            res.statusCode = err.status || 500;
            res.end(
              JSON.stringify({
                error: err.message || 'Unable to fetch GitHub data',
                rateLimit: err.rateLimit || null,
              }),
            );
          }
        });
      },
    },
  ],
});
