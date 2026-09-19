// Piccolo server locale per guardare il branco dal vivo: node serve.mjs → http://127.0.0.1:7811/grafo.html
// Serve solo i file di questa cartella, solo al tuo PC (127.0.0.1).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 7811);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.log': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname === '/' ? '/grafo.html' : url.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('non trovato'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`🐺 Grafo del branco: http://127.0.0.1:${PORT}/grafo.html?corsa=equilibrio`));
