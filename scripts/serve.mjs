#!/usr/bin/env node
/** Локальный сервер для просмотра собранного сайта: node scripts/serve.mjs [порт] */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from './lib/log.mjs';
import { DIST_DIR } from './lib/store.mjs';

const log = createLogger('serve');
const port = Number(process.argv[2] ?? 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(DIST_DIR, relative);

    if (!file.startsWith(DIST_DIR)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    }
  })
  .listen(port, () => log.info(`http://localhost:${port}`));
