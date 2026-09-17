// Hooks: file JavaScript che intercettano il lavoro dell'agente (in stile OpenClaw).
// Ogni file in ~/.openhowl/hooks/*.mjs può esportare:
//   export async function beforeTool({ name, input, harness })
//     → { deny: 'motivo' }      blocca lo strumento
//     → { input: {...} }        modifica i parametri
//     → { approve: true }       salta la richiesta di permesso per questa chiamata
//   export async function afterTool({ name, input, output, harness })
//     → { output: '...' }       sostituisce il risultato mostrato al modello
//   export async function onUserMessage({ text, harness })
//     → { text: '...' }         riscrive il messaggio dell'utente
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, ROOT } from './config.js';

export const HOOKS_DIR = path.join(DATA_DIR, 'hooks');
const BUNDLED = path.join(ROOT, 'hooks');

export async function loadHooks(harness) {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  if (fs.existsSync(BUNDLED)) {
    for (const f of fs.readdirSync(BUNDLED)) {
      const dst = path.join(HOOKS_DIR, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(path.join(BUNDLED, f), dst);
    }
  }
  const hooks = [];
  for (const f of fs.readdirSync(HOOKS_DIR)) {
    if (!/\.m?js$/.test(f) || f.startsWith('_')) continue;
    try {
      const mod = await import(`${pathToFileURL(path.join(HOOKS_DIR, f)).href}?v=${Date.now()}`);
      hooks.push({ name: f, ...mod });
    } catch (e) {
      harness?.send('error', { text: `Hook "${f}" non caricato: ${e.message}` });
    }
  }
  return hooks;
}

// Esegue un punto di aggancio su tutti gli hook, unendo i risultati.
export async function runHook(harness, point, payload) {
  let result = { ...payload };
  for (const h of harness.hooks || []) {
    const fn = h[point];
    if (typeof fn !== 'function') continue;
    try {
      const r = await fn({ ...result, harness });
      if (!r) continue;
      if (r.deny) return { ...result, deny: r.deny, hook: h.name };
      result = { ...result, ...r, hook: h.name };
    } catch (e) {
      harness.send('error', { text: `Hook "${h.name}" (${point}) ha dato errore: ${e.message}` });
    }
  }
  return result;
}
