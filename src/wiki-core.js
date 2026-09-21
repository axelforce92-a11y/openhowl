import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chat } from './providers.js';
import { extractUploads } from './document-extract.js';

const WIKI_DIR = 'wiki';
const RAW_DIR = 'raw';
const SCHEMA_DIR = 'schema';
const DEFAULT_SCHEMA = `# Schema della LLM Wiki

La Wiki è conoscenza compilata, non un archivio di riassunti per documento.

- Aggiorna una pagina esistente quando una nuova fonte parla dello stesso concetto.
- Crea pagine atomiche per concetti, entità, progetti, procedure e sintesi.
- Ogni affermazione importante deve essere riconducibile a una fonte in \`sources\`.
- Collega le pagine con \`[[wikilink]]\` significativi, mai decorativi.
- Se le fonti sono in conflitto, conserva entrambe le posizioni e segnala il conflitto.
- Non inventare fatti mancanti e non cancellare informazione supportata senza motivo.

## Operazioni

### Ingest
Leggi una fonte raw immutabile, identifica ciò che cambia nella conoscenza esistente e aggiorna tutte le pagine coinvolte. Una fonte può modificare molte pagine. Aggiorna sempre indice e registro.

### Query
Parti da index.md, cerca le pagine pertinenti e segui i wikilink. Cita le pagine e le fonti usate. Una sintesi utile emersa dalla domanda può essere salvata come nuova pagina.

### Lint
Cerca contraddizioni, affermazioni superate, pagine orfane, concetti senza pagina, collegamenti mancanti, lacune informative e nuove domande da investigare.

## File speciali

- index.md è il catalogo tematico e si rigenera dopo ogni modifica.
- log.md è append-only; ogni evento usa il titolo \`## [data] operazione | oggetto\`.
- hot.md raccoglie le pagine aggiornate più recentemente.

<!-- openhowl-wiki-v2 -->
`;

const safeSegment = (value, fallback = 'nota') => String(value || fallback)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || fallback;
const rootOf = (workspace) => path.join(workspace, WIKI_DIR);
const rawRootOf = (workspace) => path.join(workspace, RAW_DIR);
const schemaRootOf = (workspace) => path.join(workspace, SCHEMA_DIR);
const fileOf = (workspace, rel) => {
  const normalized = String(rel || '').replace(/\\/g, '/');
  if (normalized === RAW_DIR || normalized.startsWith(`${RAW_DIR}/`)) return path.join(workspace, normalized);
  if (normalized === SCHEMA_DIR || normalized.startsWith(`${SCHEMA_DIR}/`)) return path.join(workspace, normalized);
  return path.join(rootOf(workspace), normalized);
};
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const unique = (xs) => [...new Set(xs.filter(Boolean))];
const wikiLinks = (text) => unique([...String(text).matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim()));
const words = (text) => unique((String(text).toLowerCase().match(/[a-zà-ÿ0-9][a-zà-ÿ0-9_-]{2,}/g) || []));
// Un modello locale che ragiona (Qwen, DeepSeek-R1...) puo' impiegare minuti su un solo chunk:
// 4 minuti bastano per le API cloud ma tagliano a meta' l'ingest in locale.
const brainTimeout = (provider) => Number(provider.timeoutMs) ||
  (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i.test(String(provider.baseUrl || '')) ? 30 * 60 * 1000 : 4 * 60 * 1000);
const textResponse = (r) => r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();

function ensureWiki(workspace) {
  const root = rootOf(workspace);
  fs.mkdirSync(rawRootOf(workspace), { recursive: true });
  fs.mkdirSync(schemaRootOf(workspace), { recursive: true });
  for (const dir of ['pages/concepts', 'pages/entities', 'pages/projects', 'pages/procedures', 'pages/syntheses', 'lint']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const schemaFile = fileOf(workspace, 'schema/SCHEMA.md');
  if (!fs.existsSync(schemaFile)) fs.writeFileSync(schemaFile, DEFAULT_SCHEMA);
  else {
    const current = fs.readFileSync(schemaFile, 'utf8');
    if (!current.includes('openhowl-wiki-v2')) fs.writeFileSync(schemaFile, `${current.trim()}\n\n${DEFAULT_SCHEMA.slice(DEFAULT_SCHEMA.indexOf('## Operazioni'))}`);
  }
  if (!fs.existsSync(path.join(root, 'manifest.json'))) fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, sources: [] }, null, 2));
  const structuralFiles = new Map([
    ['index.md', '# Indice della LLM Wiki\n'],
    ['hot.md', '# Conoscenza recente\n'],
    ['log.md', '# Registro della LLM Wiki\n'],
  ]);
  for (const [name, initial] of structuralFiles) {
    const target = path.join(root, name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, `${initial}\n`);
  }
  return root;
}
function manifest(workspace) {
  ensureWiki(workspace);
  try { return JSON.parse(fs.readFileSync(fileOf(workspace, 'manifest.json'), 'utf8')); }
  catch { return { version: 1, sources: [] }; }
}
function saveManifest(workspace, value) { fs.writeFileSync(fileOf(workspace, 'manifest.json'), JSON.stringify(value, null, 2)); }
export function appendWikiLog(workspace, operation, title, details = []) {
  ensureWiki(workspace);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const lines = Array.isArray(details) ? details : [details];
  fs.appendFileSync(fileOf(workspace, 'log.md'), `\n## [${date}] ${operation} | ${title}\n\n- Ora: ${now.toISOString()}\n${lines.filter(Boolean).map((x) => `- ${x}`).join('\n')}\n`);
}
function allMarkdown(workspace) {
  ensureWiki(workspace);
  const base = fileOf(workspace, 'pages'), out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith('.md')) out.push(path.relative(rootOf(workspace), abs).replace(/\\/g, '/'));
    }
  };
  walk(base);
  return out;
}
function parsePage(workspace, rel) {
  const markdown = fs.readFileSync(fileOf(workspace, rel), 'utf8');
  const front = markdown.match(/^---\n([\s\S]*?)\n---\n?/), meta = {};
  for (const line of (front?.[1] || '').split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (m) meta[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  const title = meta.title || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(rel, '.md');
  return { id: rel, file: rel, title, type: meta.type || rel.split('/')[1] || 'concept', summary: meta.summary || markdown.match(/^>\s*(.+)$/m)?.[1]?.trim() || '', brain: meta.brain || '', model: meta.model || '', updatedAt: meta.updated_at || '', sources: (meta.sources || '').split('|').filter(Boolean), links: wikiLinks(markdown), markdown };
}
function pages(workspace) { return allMarkdown(workspace).map((rel) => parsePage(workspace, rel)); }
function strip(page) { const { markdown, ...publicPage } = page; return publicPage; }
function yaml(value) { return `'${String(value || '').replace(/'/g, "''")}'`; }
function kindDir(type) { return ({ entity: 'entities', project: 'projects', procedure: 'procedures', synthesis: 'syntheses' })[type] || 'concepts'; }

function rawSources(workspace) {
  ensureWiki(workspace);
  const mf = manifest(workspace), ingested = new Map(mf.sources.map((source) => [source.raw, source]));
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const raw = path.relative(workspace, absolute).replace(/\\/g, '/');
        const source = ingested.get(raw);
        const complete = !!source && (source.status === 'ingested' || !!source.pages?.length) && (source.pages || []).every((rel) => fs.existsSync(fileOf(workspace, rel)));
        out.push({ name: entry.name, raw, size: fs.statSync(absolute).size, ingested: complete, ingestedAt: complete ? source.ingestedAt : null });
      }
    }
  };
  walk(rawRootOf(workspace));
  return out.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function rebuildNavigation(workspace) {
  const list = pages(workspace).sort((a, b) => a.title.localeCompare(b.title, 'it')), groups = new Map();
  for (const p of list) { if (!groups.has(p.type)) groups.set(p.type, []); groups.get(p.type).push(p); }
  let index = '# Indice della LLM Wiki\n\n';
  for (const [type, items] of groups) index += `## ${type}\n\n${items.map((p) => `- [[${p.title}]] — ${p.summary} _(${p.sources.length} fonti · ${p.updatedAt.slice(0, 10) || 'senza data'})_`).join('\n')}\n\n`;
  const hot = [...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20);
  fs.writeFileSync(fileOf(workspace, 'index.md'), index);
  fs.writeFileSync(fileOf(workspace, 'hot.md'), `# Conoscenza recente\n\n${hot.map((p) => `- [[${p.title}]] — ${p.summary}`).join('\n')}\n`);
}
// I modelli piccoli non producono quasi mai un unico oggetto pulito: mettono prosa attorno al JSON,
// aprono e chiudono recinti ``` a metà, affiancano piu' oggetti senza array e a volte si fanno tagliare
// dal limite di token. Invece di fidarci del primo '{' e dell'ultimo '}', raccogliamo ogni blocco JSON
// bilanciato presente nel testo e teniamo quelli che parsano davvero.
function jsonBlocks(text) {
  const s = String(text), out = [];
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0, inString = false, escaped = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c.charCodeAt(0) === 92) escaped = true; // backslash
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { out.push(JSON.parse(s.slice(i, j + 1))); i = j; } catch {}
        break;
      }
    }
  }
  return out;
}
const isPagePlan = (o) => !!o && typeof o === 'object' && !Array.isArray(o) &&
  typeof (o.title ?? o.titolo) === 'string' && (o.body || o.summary || o.contenuto || o.corpo);
const asPagePlan = (o) => ({ ...o, title: o.title ?? o.titolo, body: o.body ?? o.corpo, summary: o.summary ?? o.sintesi });

function extractJson(text) {
  const clean = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?tool_call>/gi, '')
    .replace(/```[a-z]*/gi, '');
  const pages = [];
  for (const block of jsonBlocks(clean)) {
    const list = Array.isArray(block) ? block : Array.isArray(block.pages) ? block.pages : Array.isArray(block.pagine) ? block.pagine : [block];
    for (const item of list) if (isPagePlan(item)) pages.push(asPagePlan(item));
  }
  const seen = new Set(), unique = [];
  for (const page of pages) {
    const key = page.title.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); unique.push(page); }
  }
  if (!unique.length) throw new Error(`Il cervello non ha restituito un piano Wiki valido. Ha risposto: ${clean.trim().slice(0, 300) || '(nulla)'}`);
  return { pages: unique };
}
function splitText(text, maxChars) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * .55) cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * .55) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function wikiState(workspace) {
  const list = pages(workspace), byTitle = new Map(list.map((p) => [p.title.toLowerCase(), p]));
  const edges = [], seen = new Set();
  for (const p of list) for (const linked of p.links) {
    const target = byTitle.get(linked.toLowerCase());
    if (!target || target.id === p.id) continue;
    const key = [p.id, target.id].sort().join('::');
    if (!seen.has(key)) { seen.add(key); edges.push({ source: p.id, target: target.id }); }
  }
  const raw = rawSources(workspace);
  return { notes: list.map(strip), edges, sources: raw.filter((source) => source.ingested).length, rawSources: raw, pendingSources: raw.filter((source) => !source.ingested).length, path: rootOf(workspace), rawPath: rawRootOf(workspace), schemaPath: schemaRootOf(workspace), workspace, lint: lintWiki(workspace) };
}

export function storeWikiRaw(workspace, item = {}) {
  ensureWiki(workspace);
  const supplied = String(item.path || item.name || 'fonte');
  const name = path.basename(supplied);
  const ext = path.extname(name) || '.bin';
  const buffer = item.data ? Buffer.from(String(item.data), 'base64') : Buffer.from(String(item.text || ''), 'utf8');
  if (!buffer.length) throw new Error(`${name} è vuoto.`);
  if (buffer.length > 30 * 1024 * 1024) throw new Error(`${name} supera il limite di 30 MB per file.`);
  const digest = item.sourceHash || hash(buffer);
  const rawRel = `raw/${safeSegment(path.basename(name, ext))}-${digest.slice(0, 10)}${ext.toLowerCase()}`;
  const destination = fileOf(workspace, rawRel);
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, buffer);
  return { rawRel, sourceHash: digest, size: buffer.length, name };
}

export function removeWikiSource(workspace, rawRel) {
  ensureWiki(workspace);
  const mf = manifest(workspace);
  const source = mf.sources.find((item) => item.raw === rawRel);
  if (!source) throw new Error(`Fonte Wiki non trovata: ${rawRel}`);
  const removedPages = [], updatedPages = [];
  for (const rel of unique(source.pages || [])) {
    const absolute = fileOf(workspace, rel);
    if (!fs.existsSync(absolute)) continue;
    const page = parsePage(workspace, rel);
    const remaining = page.sources.filter((item) => item !== rawRel);
    if (!remaining.length) {
      fs.rmSync(absolute);
      removedPages.push(rel);
    } else {
      const next = page.markdown.replace(/^sources:.*$/m, `sources: ${remaining.join('|')}`);
      fs.writeFileSync(absolute, next);
      updatedPages.push(rel);
    }
  }
  const rawFile = fileOf(workspace, rawRel);
  const relativeRaw = path.relative(rawRootOf(workspace), rawFile);
  if (relativeRaw && !relativeRaw.startsWith('..') && !path.isAbsolute(relativeRaw) && fs.existsSync(rawFile)) fs.rmSync(rawFile);
  mf.sources = mf.sources.filter((item) => item.raw !== rawRel);
  saveManifest(workspace, mf);
  rebuildNavigation(workspace);
  appendWikiLog(workspace, 'source-delete', source.name || rawRel, [`Fonte rimossa: ${rawRel}`, `Pagine eliminate: ${removedPages.length}`, `Pagine aggiornate: ${updatedPages.length}`]);
  return { removedPages, updatedPages, ...wikiState(workspace) };
}

export function deleteWikiPage(workspace, ref) {
  ensureWiki(workspace);
  const page = readWiki(workspace, ref);
  const absolute = fileOf(workspace, page.file);
  const relative = path.relative(path.join(rootOf(workspace), 'pages'), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La pagina richiesta non appartiene alla Wiki.');
  fs.rmSync(absolute);
  const mf = manifest(workspace);
  for (const source of mf.sources) {
    if ((source.pages || []).includes(page.file)) {
      source.pages = source.pages.filter((file) => file !== page.file);
      source.status = 'ingested';
    }
  }
  saveManifest(workspace, mf);
  rebuildNavigation(workspace);
  appendWikiLog(workspace, 'page-delete', page.title, [`Pagina eliminata: ${page.file}`, 'Le fonti raw non sono state modificate.']);
  return { deleted: strip(page), ...wikiState(workspace) };
}
export function readWiki(workspace, ref) {
  const q = String(ref || '').toLowerCase();
  const page = pages(workspace).find((p) => p.id.toLowerCase() === q || p.title.toLowerCase() === q || safeSegment(p.title) === safeSegment(q));
  if (!page) throw new Error(`Pagina Wiki non trovata: ${ref}`);
  return page;
}
export function navigateWiki(workspace, action, input = {}) {
  const list = pages(workspace);
  if (action === 'overview') {
    const read = (rel) => { try { return fs.readFileSync(fileOf(workspace, rel), 'utf8'); } catch { return ''; } };
    return { index: read('index.md'), hot: read('hot.md'), total: list.length };
  }
  if (action === 'read') return readWiki(workspace, input.page);
  if (action === 'links') {
    const page = readWiki(workspace, input.page);
    return { page: strip(page), outgoing: page.links, backlinks: list.filter((p) => p.links.some((x) => x.toLowerCase() === page.title.toLowerCase())).map(strip) };
  }
  if (action === 'find') {
    const terms = words(input.query).filter((w) => w.length > 2);
    return list.map((p) => ({ p, score: terms.reduce((n, w) => n + (`${p.title} ${p.summary} ${p.markdown}`.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter((x) => x.score).sort((a, b) => b.score - a.score).slice(0, 12).map((x) => strip(x.p));
  }
  throw new Error('Azione Wiki sconosciuta.');
}
export function lintWiki(workspace) {
  const list = pages(workspace), titles = new Set(list.map((p) => p.title.toLowerCase()));
  const broken = list.flatMap((p) => p.links.filter((l) => !titles.has(l.toLowerCase())).map((target) => ({ page: p.title, target })));
  const linked = new Set(list.flatMap((p) => p.links.map((l) => l.toLowerCase())));
  const orphans = list.filter((p) => !p.links.length && !linked.has(p.title.toLowerCase())).map((p) => p.title);
  const duplicates = list.filter((p, i) => list.findIndex((x) => x.title.toLowerCase() === p.title.toLowerCase()) !== i).map((p) => p.title);
  return { ok: !broken.length && !duplicates.length, broken, orphans, duplicates };
}

export function getWikiSchema(workspace) {
  ensureWiki(workspace);
  return fs.readFileSync(fileOf(workspace, 'schema/SCHEMA.md'), 'utf8');
}
export function saveWikiSchema(workspace, content) {
  ensureWiki(workspace);
  const text = String(content || '').trim();
  if (text.length < 40) throw new Error('Lo schema è troppo corto: descrivi struttura e regole operative della Wiki.');
  fs.writeFileSync(fileOf(workspace, 'schema/SCHEMA.md'), `${text}\n`);
  appendWikiLog(workspace, 'schema', 'Regole aggiornate', ['Schema della Wiki modificato dall’utente.']);
  return text;
}
export function getWikiLog(workspace) {
  ensureWiki(workspace);
  try { return fs.readFileSync(fileOf(workspace, 'log.md'), 'utf8'); } catch { return '# Registro della LLM Wiki\n'; }
}

export function writeWikiPage(workspace, input, provider) {
  ensureWiki(workspace);
  const title = String(input.title || '').trim().slice(0, 120);
  if (!title) throw new Error('Serve un titolo per salvare la pagina Wiki.');
  const existing = pages(workspace).find((p) => p.title.toLowerCase() === title.toLowerCase());
  const type = ['entity', 'project', 'procedure', 'synthesis'].includes(input.type) ? input.type : 'synthesis';
  const rel = existing?.file || `pages/${kindDir(type)}/${safeSegment(title)}.md`;
  const summary = String(input.summary || '').trim().slice(0, 300);
  const body = String(input.body || '').trim();
  if (!body) throw new Error('La pagina Wiki non può essere vuota.');
  const links = unique([...(input.links || []), ...wikiLinks(body)]).filter((l) => l.toLowerCase() !== title.toLowerCase());
  const sources = unique([...(existing?.sources || []), ...(input.sources || [])]);
  const now = new Date().toISOString();
  const markdown = `---\ntitle: ${yaml(title)}\ntype: ${type}\nsummary: ${yaml(summary)}\nsources: ${sources.join('|')}\nbrain: ${yaml(provider.name || provider.model)}\nmodel: ${yaml(provider.model)}\nupdated_at: ${now}\nconfidence: ${Number(input.confidence) || 0.75}\n---\n\n# ${title}\n\n> ${summary}\n\n${body}\n\n## Collegamenti\n\n${links.map((l) => `- [[${l}]]`).join('\n') || '- Nessun collegamento ancora'}\n`;
  fs.mkdirSync(path.dirname(fileOf(workspace, rel)), { recursive: true });
  fs.writeFileSync(fileOf(workspace, rel), markdown);
  rebuildNavigation(workspace);
  appendWikiLog(workspace, 'query', title, [`${existing ? 'Aggiornata' : 'Creata'} ${rel}`, `Cervello: ${provider.name || provider.model}`, `Collegamenti: ${links.length}`]);
  return strip(parsePage(workspace, rel));
}

export async function semanticLintWiki(workspace, provider) {
  ensureWiki(workspace);
  const list = pages(workspace);
  if (!list.length) throw new Error('La Wiki è vuota: importa prima almeno una fonte.');
  const structural = lintWiki(workspace);
  const contextLimit = Number(provider.contextLimit) || 16000;
  const batchChars = Math.max(10000, Math.min(50000, contextLimit * 2));
  const batches = [];
  let batch = '';
  for (const p of list) {
    const page = `--- ${p.title} | ${p.type} | ${p.file} ---\n${p.markdown}\n\n`;
    if (batch && batch.length + page.length > batchChars) { batches.push(batch); batch = ''; }
    batch += page.slice(0, batchChars);
  }
  if (batch) batches.push(batch);
  const partials = [];
  for (let i = 0; i < batches.length; i++) {
    const response = await chat(provider, {
      system: 'Sei il revisore scettico di una LLM Wiki. Produci note di lint operative in Markdown. Distingui conflitti reali da differenze di prospettiva e cita le pagine con [[wikilink]].',
      messages: [{ role: 'user', content: `Esamina il lotto ${i + 1}/${batches.length}. Cerca contraddizioni, affermazioni superate, concetti senza pagina, collegamenti mancanti, lacune, domande e fonti da cercare.\n\n${batches[i]}` }],
      tools: [], maxTokens: Math.min(Number(provider.maxTokens) || 3000, 3000), signal: AbortSignal.timeout(brainTimeout(provider)),
    });
    partials.push(textResponse(response));
  }
  let report = partials.join('\n\n---\n\n');
  if (partials.length > 1) {
    const synthesis = await chat(provider, {
      system: 'Unifica rapporti di lint di una LLM Wiki. Elimina duplicati, assegna priorità e conserva tutti i wikilink e le prove. Rispondi in Markdown con: Contraddizioni, Contenuti superati, Collegamenti e pagine mancanti, Lacune e prossime ricerche.',
      messages: [{ role: 'user', content: `Controllo strutturale:\n${JSON.stringify(structural, null, 2)}\n\nRapporti parziali:\n${report.slice(0, batchChars)}` }],
      tools: [], maxTokens: Math.min(Number(provider.maxTokens) || 3500, 3500), signal: AbortSignal.timeout(brainTimeout(provider)),
    });
    report = textResponse(synthesis) || report;
  }
  if (!report) report = '# Controllo Wiki\n\nNessun rapporto prodotto.';
  fs.writeFileSync(fileOf(workspace, 'lint/latest.md'), `${report}\n`);
  appendWikiLog(workspace, 'lint', 'Controllo completo', [`Pagine controllate: ${list.length}`, `Link rotti: ${structural.broken.length}`, `Pagine isolate: ${structural.orphans.length}`, `Cervello: ${provider.name || provider.model}`]);
  return { report, structural };
}

export async function ingestWiki(workspace, files, provider, progress = () => {}) {
  if (!Array.isArray(files) || !files.length) throw new Error('Seleziona almeno una fonte.');
  if (files.length > 20) throw new Error('Importa al massimo 20 fonti per volta.');
  ensureWiki(workspace);
  const mf = manifest(workspace), created = [], skipped = [];
  const schema = fs.readFileSync(fileOf(workspace, 'schema/SCHEMA.md'), 'utf8');
  for (let i = 0; i < files.length; i++) {
    const item = files[i] || {}, content = String(item.text || '').trim();
    if (!content) continue;
    if (content.length > 2000000) throw new Error(`${item.name || 'Una fonte'} supera 2.000.000 di caratteri.`);
    const digest = item.sourceHash || hash(content);
    const previous = mf.sources.find((source) => source.hash === digest);
    const complete = !!previous && (previous.status === 'ingested' || !!previous.pages?.length) && (previous.pages || []).every((rel) => fs.existsSync(fileOf(workspace, rel)));
    if (complete) { skipped.push(item.name); continue; }
    if (previous) mf.sources = mf.sources.filter((source) => source.hash !== digest);
    progress({ current: i + 1, total: files.length, name: item.name });
    const ext = path.extname(item.name || '') || '.txt';
    const rawRel = item.rawRel || `raw/${safeSegment(path.basename(item.name || 'fonte', ext))}-${digest.slice(0, 10)}${ext.toLowerCase()}`;
    if (!item.rawRel) fs.writeFileSync(fileOf(workspace, rawRel), item.data ? Buffer.from(item.data, 'base64') : content);
    const contextLimit = Number(provider.contextLimit) || 16000;
    const sourceBudget = Math.max(6000, Math.min(30000, Math.floor(contextLimit * 1.5)));
    const contextBudget = Math.max(3000, Math.min(16000, Math.floor(contextLimit * .7)));
    const chunks = splitText(content, sourceBudget), touched = [];
    for (let part = 0; part < chunks.length; part++) {
      progress({ current: i + 1, total: files.length, name: item.name, part: part + 1, parts: chunks.length });
      const existing = pages(workspace), sourceTerms = words(chunks[part]).filter((w) => w.length > 4);
      const relevant = existing.map((p) => ({ p, score: sourceTerms.reduce((n, w) => n + (p.markdown.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 8).map(({ p }) => `--- PAGINA ESISTENTE: ${p.title} (${p.file}) ---\n${p.markdown.slice(0, 2400)}`).join('\n\n').slice(0, contextBudget);
      const catalog = (existing.map((p) => `${p.title} — ${p.summary}`).join('\n') || '(wiki vuota)').slice(0, contextBudget);
      const compileSystem = `Sei il compilatore della LLM Wiki di OpenHowl, secondo il principio "compile, don't retrieve". La fonte raw è immutabile. Trasforma la nuova conoscenza in pagine concettuali persistenti: aggiorna pagine esistenti, evita una pagina per documento, preserva divergenze e provenienza, crea wikilink reali.\n\n${schema.slice(0, contextBudget)}\n\nRestituisci SOLO JSON valido: {"pages":[{"title":"...","type":"concept|entity|project|procedure|synthesis","summary":"una frase","body":"Markdown completo senza titolo H1 e senza frontmatter","links":["Titolo esatto"],"confidence":0.0}]}. Rispondi con UN SOLO oggetto JSON: nessun testo prima o dopo, nessun recinto di codice, tutte le pagine dentro un unico array "pages".`;
      const compileUser = `FONTE IMMUTABILE: ${rawRel} — parte ${part + 1}/${chunks.length}\n\n${chunks[part]}\n\nCATALOGO:\n${catalog}\n\nPAGINE RILEVANTI:\n${relevant || '(nessuna)'}`;
      const compile = (messages) => chat(provider, {
        system: compileSystem, messages,
        tools: [], maxTokens: Math.min(Number(provider.maxTokens) || 4096, 4096), signal: AbortSignal.timeout(brainTimeout(provider)),
      });
      const answer = textResponse(await compile([{ role: 'user', content: compileUser }]));
      let plan;
      try {
        plan = extractJson(answer);
      } catch (malformed) {
        // Un modello piccolo sbaglia spesso il formato al primo colpo: invece di perdere tutta la parte,
        // gli rimandiamo la sua stessa risposta e gli chiediamo solo di riscriverla come JSON.
        progress({ current: i + 1, total: files.length, name: item.name, part: part + 1, parts: chunks.length, repair: true });
        const repaired = textResponse(await compile([
          { role: 'user', content: compileUser },
          { role: 'assistant', content: answer || '(nessuna risposta)' },
          { role: 'user', content: 'La tua risposta non era JSON valido. Riscrivi lo stesso contenuto come un unico oggetto {\"pages\":[...]}: nessuna spiegazione, nessun recinto di codice, ogni pagina come elemento dell\'array.' },
        ]));
        try { plan = extractJson(repaired); } catch { throw malformed; }
      }
      if (!Array.isArray(plan.pages) || !plan.pages.length) throw new Error(`Nessuna pagina compilata da ${item.name}, parte ${part + 1}.`);
      for (const proposed of plan.pages.slice(0, 16)) {
        const title = String(proposed.title || '').trim().slice(0, 120); if (!title) continue;
        const current = pages(workspace).find((p) => p.title.toLowerCase() === title.toLowerCase());
        const type = ['entity', 'project', 'procedure', 'synthesis'].includes(proposed.type) ? proposed.type : 'concept';
        const rel = current?.file || `pages/${kindDir(type)}/${safeSegment(title)}.md`;
        const links = unique([...(proposed.links || []), ...wikiLinks(proposed.body)]).filter((l) => l.toLowerCase() !== title.toLowerCase());
        const now = new Date().toISOString(), summary = String(proposed.summary || '').trim().slice(0, 300);
        const markdown = `---\ntitle: ${yaml(title)}\ntype: ${type}\nsummary: ${yaml(summary)}\nsources: ${unique([...(current?.sources || []), rawRel]).join('|')}\nbrain: ${yaml(provider.name || provider.model)}\nmodel: ${yaml(provider.model)}\nupdated_at: ${now}\nconfidence: ${Number(proposed.confidence) || 0.7}\n---\n\n# ${title}\n\n> ${summary}\n\n${String(proposed.body || '').trim()}\n\n## Collegamenti\n\n${links.map((l) => `- [[${l}]]`).join('\n') || '- Nessun collegamento ancora'}\n`;
        fs.mkdirSync(path.dirname(fileOf(workspace, rel)), { recursive: true }); fs.writeFileSync(fileOf(workspace, rel), markdown);
        touched.push(rel); created.push({ title, file: rel, updated: !!current });
      }
    }
    const sourceRecord = { name: String(item.name || 'fonte'), raw: rawRel, hash: digest, brain: provider.name || provider.model, model: provider.model, ingestedAt: new Date().toISOString(), status: 'ingested', pages: touched };
    const sourceIndex = mf.sources.findIndex((source) => source.raw === rawRel || source.hash === digest);
    if (sourceIndex >= 0) mf.sources[sourceIndex] = sourceRecord;
    else mf.sources.push(sourceRecord);
    saveManifest(workspace, mf);
    appendWikiLog(workspace, 'ingest', item.name, [`Fonte raw: ${rawRel}`, `Cervello: ${provider.name || provider.model}`, `Pagine toccate: ${touched.join(', ')}`]);
    rebuildNavigation(workspace);
  }
  return { created, skipped, ...wikiState(workspace) };
}

export async function ingestStoredWikiSources(workspace, refs, provider, progress = () => {}) {
  const available = rawSources(workspace);
  const requested = Array.isArray(refs) ? refs.map((ref) => String(ref || '').trim()).filter(Boolean) : [];
  let selected;
  if (!requested.length) selected = available.filter((source) => !source.ingested);
  else selected = requested.map((ref) => {
    const q = ref.replace(/\\/g, '/').toLowerCase();
    const matches = available.filter((source) => source.raw.toLowerCase() === q || source.name.toLowerCase() === q || path.basename(source.raw).toLowerCase() === q);
    if (!matches.length) throw new Error(`Fonte raw non trovata: ${ref}`);
    if (matches.length > 1) throw new Error(`Nome ambiguo in raw: ${ref}. Specifica il percorso.`);
    return matches[0];
  });
  selected = unique(selected.map((source) => source.raw)).map((raw) => available.find((source) => source.raw === raw));
  if (!selected.length) return { message: 'Non ci sono nuove fonti raw da elaborare.', created: [], skipped: [], ...wikiState(workspace) };
  const created = [], skipped = [];
  for (let i = 0; i < selected.length; i++) {
    const source = selected[i], absolute = fileOf(workspace, source.raw);
    progress({ phase: 'extract', current: i + 1, total: selected.length, name: source.name });
    const buffer = fs.readFileSync(absolute);
    const extracted = await extractUploads([{ name: source.name, path: source.raw, data: buffer.toString('base64') }]);
    const result = await ingestWiki(workspace, extracted.map((item) => ({ ...item, rawRel: source.raw })), provider,
      (event) => progress({ phase: 'compile', ...event, current: i + 1, total: selected.length, name: source.name }));
    created.push(...result.created);
    skipped.push(...result.skipped);
  }
  return { created, skipped, ...wikiState(workspace) };
}

export const wikiTool = {
  name: 'wiki',
  description: 'Naviga e mantiene la LLM Wiki compilata del progetto. sources elenca i file caricati in raw e indica quelli in attesa. ingest elabora le fonti raw solo quando l’utente lo chiede esplicitamente: senza files elabora tutte quelle in attesa. Per rispondere: overview, find, read, links. Usa write solo quando l’utente chiede di archiviare una sintesi utile emersa dalla conversazione.',
  input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['overview', 'find', 'read', 'links', 'sources', 'ingest', 'write'] }, page: { type: 'string' }, query: { type: 'string' }, files: { type: 'array', items: { type: 'string' }, description: 'Nomi o percorsi raw da elaborare; ometti per tutte le fonti in attesa.' }, title: { type: 'string' }, type: { type: 'string', enum: ['concept', 'entity', 'project', 'procedure', 'synthesis'] }, summary: { type: 'string' }, body: { type: 'string' }, links: { type: 'array', items: { type: 'string' } }, sources: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' } }, required: ['action'] },
  risk: (input) => ['write', 'ingest'].includes(input.action) ? 'write' : 'read',
  async run(input, ctx) {
    if (input.action === 'write') return JSON.stringify(writeWikiPage(ctx.workspace, input, ctx.h.providerInfo()), null, 2);
    if (input.action === 'sources') return JSON.stringify(rawSources(ctx.workspace), null, 2);
    if (input.action === 'ingest') {
      const provider = { ...ctx.h.providerInfo(), contextLimit: ctx.h.limits.contextLimit, maxTokens: ctx.h.limits.maxTokens };
      return JSON.stringify(await ingestStoredWikiSources(ctx.workspace, input.files, provider, (event) => ctx.h.broadcast?.('wiki_progress', event)), null, 2);
    }
    return JSON.stringify(navigateWiki(ctx.workspace, input.action, input), null, 2);
  },
};
