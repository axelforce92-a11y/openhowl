// Strumenti filesystem: leggere, scrivere, modificare, elencare, cercare.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveUserPath } from '../paths.js';

const resolve = (ctx, p = '.') => resolveUserPath(ctx.workspace, p);
const IGNORE = /(^|[\\/])(node_modules|\.git|\.openhowl|dist|build|__pycache__|\.venv|\.next)([\\/]|$)/;
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

async function* walk(base, pattern = '**/*') {
  for await (const rel of fsp.glob(pattern, { cwd: base, exclude: (f) => IGNORE.test(f) })) {
    if (IGNORE.test(rel)) continue;
    yield rel;
  }
}

export const fsTools = [
  {
    name: 'read_file',
    description: 'Legge un file (testo con numeri di riga, oppure immagine png/jpg/webp). Per file grandi usa offset e limit.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'percorso relativo alla workspace o assoluto' },
        offset: { type: 'integer', description: 'riga iniziale, 1-based' },
        limit: { type: 'integer', description: 'numero massimo di righe (default 2000)' },
      },
      required: ['path'],
    },
    risk: 'read',
    async run({ path: p, offset = 1, limit = 2000 }, ctx) {
      const f = resolve(ctx, p);
      const st = await fsp.stat(f);
      if (st.isDirectory()) throw new Error('È una cartella: usa list_dir');
      const mime = IMAGE_EXT[path.extname(f).toLowerCase()];
      if (mime) {
        if (st.size > 5_000_000) throw new Error('Immagine troppo grande (>5MB)');
        return { text: `${f} (immagine ${Math.round(st.size / 1024)}KB)`, images: [{ media_type: mime, data: (await fsp.readFile(f)).toString('base64') }] };
      }
      if (st.size > 20_000_000) throw new Error('File troppo grande (>20MB)');
      const lines = (await fsp.readFile(f, 'utf8')).split(/\r?\n/);
      const start = Math.max(1, offset);
      const slice = lines.slice(start - 1, start - 1 + limit);
      const rest = lines.length - (start - 1 + slice.length);
      return `${f} — ${lines.length} righe\n` +
        slice.map((l, i) => `${String(start + i).padStart(5)}│${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n') +
        (rest > 0 ? `\n… altre ${rest} righe (usa offset)` : '');
    },
  },
  {
    name: 'write_file',
    description: 'Crea o sovrascrive un file con il contenuto dato. Crea le cartelle mancanti. Per modifiche puntuali preferisci edit_file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    risk: 'write',
    async run({ path: p, content }, ctx) {
      const f = resolve(ctx, p);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await fsp.writeFile(f, content, 'utf8');
      const size = (await fsp.stat(f)).size;
      return `Scritto e verificato: ${f} (${content.split('\n').length} righe, ${size} byte)`;
    },
  },
  {
    name: 'create_folder',
    description: 'Crea una cartella (anche annidata). Accetta percorsi come "Desktop\\Progetto", "Documenti\\Note" o assoluti. Restituisce il percorso reale verificato.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    risk: 'write',
    async run({ path: p }, ctx) {
      const d = resolve(ctx, p);
      const existed = fs.existsSync(d);
      await fsp.mkdir(d, { recursive: true });
      if (!fs.statSync(d).isDirectory()) throw new Error(`Impossibile creare la cartella: ${d}`);
      return `${existed ? 'La cartella esisteva già' : 'Cartella creata e verificata'}: ${d}`;
    },
  },
  {
    name: 'edit_file',
    description: 'Sostituisce un testo esatto in un file. old_string deve essere unico nel file (includi abbastanza contesto) a meno di replace_all=true. Leggi il file prima.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    risk: 'write',
    async run({ path: p, old_string, new_string, replace_all }, ctx) {
      const f = resolve(ctx, p);
      let text = await fsp.readFile(f, 'utf8');
      // tollera differenze CRLF/LF tra file e richiesta del modello
      const crlf = text.includes('\r\n');
      if (crlf) text = text.replace(/\r\n/g, '\n');
      const oldS = old_string.replace(/\r\n/g, '\n'), newS = new_string.replace(/\r\n/g, '\n');
      const count = text.split(oldS).length - 1;
      if (count === 0) throw new Error('old_string non trovato nel file. Rileggi il file e riprova con il testo esatto.');
      if (count > 1 && !replace_all) throw new Error(`old_string compare ${count} volte: aggiungi contesto per renderlo unico o usa replace_all.`);
      text = replace_all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
      await fsp.writeFile(f, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
      return `Modificato ${f} (${replace_all ? count : 1} sostituzion${count > 1 && replace_all ? 'i' : 'e'})`;
    },
  },
  {
    name: 'list_dir',
    description: 'Elenca il contenuto di una cartella.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
    risk: 'read',
    async run({ path: p = '.' }, ctx) {
      const d = resolve(ctx, p);
      const entries = await fsp.readdir(d, { withFileTypes: true });
      const rows = await Promise.all(entries.slice(0, 500).map(async (e) => {
        if (e.isDirectory()) return `📁 ${e.name}/`;
        const st = await fsp.stat(path.join(d, e.name)).catch(() => null);
        return `   ${e.name}${st ? `  (${st.size < 1024 ? st.size + 'B' : Math.round(st.size / 1024) + 'KB'})` : ''}`;
      }));
      return `${d}\n${rows.join('\n') || '(vuota)'}${entries.length > 500 ? `\n… ${entries.length - 500} altri` : ''}`;
    },
  },
  {
    name: 'glob',
    description: 'Trova file per pattern glob (es. "**/*.ts", "src/**/test*"). Ignora node_modules, .git, build.',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
    risk: 'read',
    async run({ pattern, path: p = '.' }, ctx) {
      const base = resolve(ctx, p);
      const out = [];
      for await (const f of walk(base, pattern)) {
        out.push(f);
        if (out.length >= 500) break;
      }
      return out.length ? `${base}\n${out.join('\n')}${out.length >= 500 ? '\n… (troncato a 500)' : ''}` : 'Nessun file trovato.';
    },
  },
  {
    name: 'grep',
    description: 'Cerca una regex nel contenuto dei file. Restituisce file:riga: testo.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'espressione regolare JavaScript' },
        path: { type: 'string' },
        glob: { type: 'string', description: 'filtro file, es. "**/*.js"' },
        ignore_case: { type: 'boolean' },
      },
      required: ['pattern'],
    },
    risk: 'read',
    async run({ pattern, path: p = '.', glob = '**/*', ignore_case }, ctx) {
      const base = resolve(ctx, p);
      const re = new RegExp(pattern, ignore_case ? 'i' : '');
      const out = [];
      const st = await fsp.stat(base);
      const files = st.isFile() ? [path.basename(base)] : walk(base, glob);
      const dir = st.isFile() ? path.dirname(base) : base;
      for await (const rel of files) {
        const f = path.join(dir, rel);
        const s = await fsp.stat(f).catch(() => null);
        if (!s?.isFile() || s.size > 2_000_000) continue;
        const buf = await fsp.readFile(f);
        if (buf.subarray(0, 8000).includes(0)) continue; // binario
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
            if (out.length >= 300) return out.join('\n') + '\n… (troncato a 300 risultati)';
          }
        }
      }
      return out.length ? out.join('\n') : 'Nessuna corrispondenza.';
    },
  },
];
