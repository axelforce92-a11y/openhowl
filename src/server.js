#!/usr/bin/env node
// Server locale di OpenHowl: serve l'interfaccia e trasmette gli eventi dell'agente in tempo reale (Server-Sent Events).
// Ascolta solo su 127.0.0.1 e richiede un token segreto per ogni chiamata API (protezione da siti malevoli).
// Usato dall'app desktop (electron/main.cjs) oppure da solo con:  node src/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, providerInfo, ROOT } from './config.js';
import { chat, detectLocal, listModels } from './providers.js';
import { Harness } from './harness.js';
import { shutdownShells } from './tools/shell.js';
import { shutdownComputer } from './tools/computer.js';

const UI = path.join(ROOT, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
});
const json = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export async function startServer({ port } = {}) {
  const cfg = loadConfig();
  const h = new Harness(cfg);
  const TOKEN = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  h.on((ev) => {
    const chunk = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(chunk);
  });

  // Gestore dei "cervelli": qualsiasi modello su endpoint compatibile OpenAI o Anthropic.
  async function brainApi(action, body) {
    switch (action) {
      case 'detect': return { servers: await detectLocal() };
      case 'models': return { models: await listModels(h.resolveBrainInput(body)) };
      case 'save': return { brain: { ...h.saveBrain(body.brain, !!body.activate), apiKey: undefined } };
      case 'delete': h.deleteBrain(body.id); return { ok: true };
      case 'activate': h.activateBrain(body.id); return { ok: true };
      case 'test': {
        // Verifica risposta e capacità di chiamare strumenti (fondamentale per un agente).
        const b = h.resolveBrainInput(body.brain);
        const p = providerInfo({ brain: { ...b, apiKey: b.apiKey || 'local' } });
        const t0 = Date.now();
        const resp = await chat(p, {
          system: 'Sei un assistente di test.',
          messages: [{ role: 'user', content: 'Chiama lo strumento get_time con timezone "Europe/Rome". Non scrivere altro.' }],
          tools: [{ name: 'get_time', description: 'Restituisce l\'ora in un fuso orario', input_schema: { type: 'object', properties: { timezone: { type: 'string' } }, required: ['timezone'] } }],
          maxTokens: 1024,
          signal: AbortSignal.timeout(120000),
        });
        const call = resp.content.find((x) => x.type === 'tool_use');
        return {
          ms: Date.now() - t0,
          toolCalling: !!call,
          call: call ? `${call.name}(${JSON.stringify(call.input)})` : null,
          text: resp.content.filter((x) => x.type === 'text').map((x) => x.text).join('').slice(0, 300),
          thinking: resp.content.some((x) => x.type === 'thinking'),
          usage: resp.usage,
        };
      }
      default: throw new Error('azione sconosciuta');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end('host non consentito'); }

    if (url.pathname.startsWith('/api/')) {
      const ok = req.headers['x-howl-token'] === TOKEN || (url.pathname === '/api/events' && url.searchParams.get('t') === TOKEN);
      if (!ok) return json(res, { error: 'token non valido' }, 401);

      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'snapshot', ...h.snapshot() })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (req.method !== 'POST') return json(res, { error: 'metodo' }, 405);
      const body = await readBody(req);
      if (url.pathname === '/api/message') {
        h.handleInput(body.text).catch((e) => h.send('error', { text: e.message }));
        return json(res, { ok: true });
      }
      if (url.pathname === '/api/approve') { h.resolveApproval(body.id, !!body.allow, !!body.always); return json(res, { ok: true }); }
      if (url.pathname === '/api/stop') { h.stop(); return json(res, { ok: true }); }
      if (url.pathname === '/api/useraction') { h.resolveUserAction(body.id, body.outcome); return json(res, { ok: true }); }
      if (url.pathname === '/api/chat/new') { h.newChat(); return json(res, { ok: true }); }
      if (url.pathname === '/api/chat/open') { h.openSession(body.id); return json(res, { ok: true }); }
      if (url.pathname === '/api/chat/delete') { h.removeSession(body.id); return json(res, { ok: true }); }
      if (url.pathname === '/api/chat/rename') { h.renameSession(body.id, body.title); return json(res, { ok: true }); }
      if (url.pathname.startsWith('/api/brains/')) {
        try { return json(res, await brainApi(url.pathname.slice(12), body)); } catch (e) { return json(res, { error: e.message }); }
      }
      return json(res, { error: 'non trovato' }, 404);
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(UI, rel);
    if (!file.startsWith(UI) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    let content = fs.readFileSync(file);
    if (file.endsWith('.html')) content = content.toString().replace('%%HOWL_TOKEN%%', TOKEN);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  });

  await h.init();
  const listen = (p) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
  });
  let actualPort;
  try { actualPort = await listen(port ?? cfg.port); } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    actualPort = await listen(0); // porta occupata: ne scegliamo una libera
  }

  return {
    port: actualPort,
    token: TOKEN,
    url: `http://127.0.0.1:${actualPort}`,
    harness: h,
    close() {
      h.stop();
      for (const c of h.mcpClients) c.close();
      shutdownShells();
      shutdownComputer();
      server.close();
    },
  };
}

// Avvio diretto da terminale
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const s = await startServer();
  const cfg = s.harness.cfg;
  const p = s.harness.providerInfo();
  console.log(`\n  🐺 OpenHowl in ascolto su ${s.url}`);
  console.log(`  Cervello:  ${p.name} / ${p.model}`);
  console.log(`  Workspace: ${cfg.workspace}`);
  console.log(`  Permessi:  ${cfg.mode}\n`);
  process.on('SIGINT', () => { s.close(); process.exit(0); });
}
