// Storico delle conversazioni: ogni chat è un file JSON in ~/.openhowl/sessions.
// Contiene la trascrizione per il modello, gli eventi per l'interfaccia, il piano e lo stato del goal.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './config.js';

const DIR = path.join(DATA_DIR, 'sessions');
const MAX_LOG = 600;

const file = (id) => path.join(DIR, `${id}.json`);

export function newSession() {
  return {
    id: randomUUID().slice(0, 8),
    title: 'Nuova conversazione',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    log: [],
    todos: [],
    goal: null,
    usage: { input: 0, output: 0 },
    context: { tokens: 0, limit: 0 },
  };
}

export function saveSession(s) {
  if (!s) return;
  fs.mkdirSync(DIR, { recursive: true });
  // gli screenshot in base64 non vengono salvati: farebbero file enormi
  const log = s.log.slice(-MAX_LOG).map((e) => (e.images?.length ? { ...e, images: [], imagesDropped: e.images.length } : e));
  const data = { ...s, log };
  fs.writeFileSync(file(s.id), JSON.stringify(data));
}

export function loadSession(id) {
  try {
    const s = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    return { ...newSession(), ...s, id };
  } catch { return null; }
}

export function deleteSession(id) {
  try { fs.rmSync(file(id)); return true; } catch { return false; }
}

// Elenco leggero per la barra laterale (senza trascrizioni).
export function listSessions(limit = 200) {
  fs.mkdirSync(DIR, { recursive: true });
  const out = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      if (!s.messages?.length && !s.log?.length) continue; // chat vuote: non le mostriamo
      out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt || 0, messages: s.messages?.length || 0, workspace: s.workspace || null });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

// Titolo automatico dal primo messaggio dell'utente.
export function titleFrom(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const clean = t.startsWith('/') ? t.replace(/^\/goal\s*/i, '🎯 ') : t;
  return clean.slice(0, 64) || 'Nuova conversazione';
}
