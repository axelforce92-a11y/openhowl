// Skills e identità (in stile OpenClaw).
//  - SOUL.md: identità e carattere dell'agente, sempre nel prompt.
//  - skills/<nome>/SKILL.md: istruzioni per un lavoro specifico. Nel prompt c'è solo il titolo
//    con la descrizione; il contenuto completo viene caricato dall'agente con lo strumento "skill".
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from './config.js';

export const SOUL_FILE = path.join(DATA_DIR, 'SOUL.md');
export const SKILLS_DIR = path.join(DATA_DIR, 'skills');
const BUNDLED = path.join(ROOT, 'skills');

const DEFAULT_SOUL = `# Identità di Howl

Sono Howl, un lupo digitale: il compagno di lavoro di chi usa OpenHowl.

## Carattere
- Diretto e concreto: prima faccio, poi racconto in breve cosa ho fatto.
- Sincero: se qualcosa non è riuscito lo dico subito, senza girarci intorno.
- Curioso: davanti a un problema nuovo esploro prima di dichiarare che è impossibile.
- Rispettoso del lavoro altrui: non cancello e non stravolgo nulla senza chiedere.

## Come parlo
- Nella lingua di chi mi scrive, con frasi brevi e parole semplici.
- Zero fuffa: nessun "certamente!", nessun elenco di buoni propositi.
- Quando riporto un risultato indico sempre la prova: percorso del file, output del comando, URL.

## Limiti che mi do
- Non dico di aver fatto una cosa se non l'ho fatta davvero.
- Password, pagamenti e verifiche anti-robot sono affar dell'utente: glieli chiedo.
- Prima di un'azione irreversibile mi fermo e chiedo.

Questo file è tuo: modificalo per cambiare il mio carattere.
`;

export function ensureDefaults() {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (!fs.existsSync(SOUL_FILE)) fs.writeFileSync(SOUL_FILE, DEFAULT_SOUL);
  // copia le skill in dotazione la prima volta (poi restano dell'utente)
  if (!fs.existsSync(BUNDLED)) return;
  for (const name of fs.readdirSync(BUNDLED)) {
    const dst = path.join(SKILLS_DIR, name);
    if (!fs.existsSync(dst)) copyDir(path.join(BUNDLED, name), dst);
  }
}

// Copia a mano: fs.cpSync non sa leggere le cartelle dentro app.asar (l'app installata si bloccava al primo avvio).
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

export function readSoul() {
  try { return fs.readFileSync(SOUL_FILE, 'utf8').slice(0, 8000); } catch { return ''; }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

// Elenco delle skill disponibili (solo titolo e descrizione: il corpo si carica a richiesta).
export function listSkills() {
  const out = [];
  for (const dir of [SKILLS_DIR, path.join(process.cwd(), '.howl', 'skills')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      try {
        const { meta, body } = parseFrontmatter(fs.readFileSync(f, 'utf8'));
        out.push({
          name: (meta.name || name).trim(),
          description: (meta.description || body.split('\n').find((l) => l.trim()) || '').slice(0, 300),
          triggers: (meta.triggers || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
          dir: path.join(dir, name),
          file: f,
        });
      } catch {}
    }
  }
  return out;
}

export function loadSkill(name) {
  const s = listSkills().find((x) => x.name.toLowerCase() === String(name).toLowerCase())
    || listSkills().find((x) => x.name.toLowerCase().includes(String(name).toLowerCase()));
  if (!s) return null;
  const { body } = parseFrontmatter(fs.readFileSync(s.file, 'utf8'));
  const extra = fs.readdirSync(s.dir).filter((f) => f !== 'SKILL.md');
  return { ...s, body: body.slice(0, 24000), files: extra };
}

// Skill pertinenti al messaggio dell'utente (i modelli piccoli non le scelgono da soli).
export function matchSkills(text) {
  const t = ` ${String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  return listSkills()
    .map((s) => ({ s, hits: s.triggers.filter((k) => t.includes(` ${k} `) || t.includes(`${k} `) || t.includes(` ${k}`)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map((x) => x.s);
}

export const skillTool = {
  name: 'skill',
  description: 'Carica le istruzioni complete di una skill (pacchetto di competenze). Usalo appena un compito corrisponde a una delle skill elencate nel prompt, PRIMA di iniziare a lavorare.',
  input_schema: { type: 'object', properties: { name: { type: 'string', description: 'nome della skill' } }, required: ['name'] },
  risk: 'read',
  async run({ name }) {
    const s = loadSkill(name);
    if (!s) throw new Error(`Skill "${name}" non trovata. Disponibili: ${listSkills().map((x) => x.name).join(', ') || 'nessuna'}`);
    const files = s.files.length ? `\n\nFile allegati nella cartella ${s.dir}:\n${s.files.map((f) => `- ${f}`).join('\n')}` : '';
    return `# Skill: ${s.name}\n\n${s.body}${files}`;
  },
};
