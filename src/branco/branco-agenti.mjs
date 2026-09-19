// Branco di agenti: agenti Qwen VERI (con strumenti) che si accoppiano, mutano e vengono selezionati con un esame.
//
// Il DNA di un agente non sono i pesi del modello (quelli restano uguali per tutti) ma il suo "modo di lavorare":
//   personalità · quanto ragiona (none/low/medium) · temperatura · regole imparate
// Accoppiamento: il figlio prende i geni dai due genitori.
// Mutazione (la "PCR" degli agenti): Qwen rilegge un caso che il genitore ha SBAGLIATO — senza sapere la risposta
// giusta — e scrive una regola generale per non ripetere l'errore.
// Selezione: esame di 6 casi con risposta esatta; i migliori si riproducono. Alla fine l'esame segreto (4 casi mai visti).
//
// Obiettivi (--obiettivo):
//   intelligenza   si riproducono i più bravi (a parità di voto, i più veloci)
//   equilibrio     selezione "di Pareto": più bravi E più veloci. Oltre alla mutazione che impara dagli errori
//                  c'è quella che impara dalla lentezza (un caso risolto giusto ma con troppi passi).
//
// Uso:  node branco-agenti.mjs [--obiettivo equilibrio] [--gen 4] [--figli 6] [--out corse/nome] [--riprendi file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESAME, SEGRETO, TOOLS, runTool } from './mondo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CFG = {
  url: arg('url', 'http://127.0.0.1:1234/v1'),
  model: arg('modello', 'qwen/qwen3.5-9b'),
  generations: Number(arg('gen', 4)),
  kidsPerGen: Number(arg('figli', 6)),
  parents: 3,
  maxSteps: 10,
  seed: Number(arg('seed', 7)),
  obiettivo: arg('obiettivo', 'intelligenza'),
  out: arg('out', '.'),
};
const OUT = path.resolve(HERE, CFG.out);
fs.mkdirSync(OUT, { recursive: true });

// generatore casuale riproducibile
let s = CFG.seed >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];

const NOMI = ['Luna', 'Ombra', 'Zanna', 'Neve', 'Fumo', 'Brace', 'Selva', 'Rupe', 'Nebbia', 'Lampo', 'Quercia', 'Artiglio',
  'Tuono', 'Cenere', 'Vento', 'Aurora', 'Fiocco', 'Sasso', 'Lince', 'Brina', 'Notte', 'Falco', 'Rovo', 'Ghiaccio'];
let nameIdx = 0;
const nextName = () => { const n = NOMI[nameIdx % NOMI.length] + (nameIdx >= NOMI.length ? `-${Math.floor(nameIdx / NOMI.length) + 1}` : ''); nameIdx++; return n; };

/* ───────── fondatori (i "primer" della PCR) ───────── */
const FONDATORI = [
  { primer: 'Scrupoloso', persona: 'Leggi sempre l\'indice e TUTTI gli articoli che potrebbero riguardare il caso prima di rispondere.', ragionamento: 'low', temperatura: 0.2 },
  { primer: 'Contabile', persona: 'Fai ogni calcolo con lo strumento calcola, mai a mente.', ragionamento: 'none', temperatura: 0.2 },
  { primer: 'Velocista', persona: 'Rispondi in fretta, con il minor numero di passi possibile.', ragionamento: 'none', temperatura: 0.5 },
  { primer: 'Cacciatore di eccezioni', persona: 'Cerca sempre eccezioni, tetti massimi e casi speciali nel regolamento.', ragionamento: 'low', temperatura: 0.3 },
  { primer: 'Pianificatore', persona: 'Prima scrivi un piano in 3 passi, poi eseguilo con gli strumenti.', ragionamento: 'medium', temperatura: 0.2 },
  { primer: 'Intuitivo', persona: 'Fidati del buon senso e dell\'esperienza.', ragionamento: 'none', temperatura: 0.8 },
];

function systemPrompt(g) {
  return `Sei un consulente dello sportello di LupoCasa e rispondi alle domande sugli affitti.
${g.persona}
${g.regole.length ? `\nRegole che hai imparato dall'esperienza:\n${g.regole.map((r) => `- ${r.testo}`).join('\n')}\n` : ''}
Usa gli strumenti per leggere il regolamento e la scheda del cliente: non inventare mai numeri o regole.
Termina SEMPRE con una riga nel formato: RISPOSTA: <numero>  (solo il numero in euro, senza simbolo).`;
}

/* ───────── chiamate al modello ───────── */
const stats = { chiamate: 0, token: 0 };
async function chat(body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${CFG.url}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: CFG.model, ...body }), signal: AbortSignal.timeout(240000),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      stats.chiamate++;
      stats.token += j.usage?.completion_tokens || 0;
      return { ...j.choices[0].message, _tok: j.usage?.completion_tokens || 0 };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// Un agente svolge un caso: modello → strumenti → modello … fino alla RISPOSTA.
async function solve(g, task) {
  const t0 = Date.now();
  const messages = [{ role: 'system', content: systemPrompt(g) }, { role: 'user', content: task.domanda }];
  const trace = [];
  let final = '';
  let nudged = false;
  let token = 0;
  for (let step = 0; step < (g.passiMax || CFG.maxSteps); step++) {
    const m = await chat({ messages, tools: TOOLS, temperature: g.temperatura, max_tokens: 1500, reasoning_effort: g.ragionamento });
    token += m._tok;
    const calls = m.tool_calls || [];
    messages.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      final = m.content || '';
      // a volte il modello chiude il turno senza scrivere nulla: gli chiediamo la risposta (una volta)
      if (!/RISPOSTA:/i.test(final) && !nudged) {
        nudged = true;
        messages.push({ role: 'user', content: 'Scrivi ora la conclusione con la riga RISPOSTA: <numero>.' });
        continue;
      }
      break;
    }
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      const out = runTool(c.function.name, args);
      trace.push(`${c.function.name}(${JSON.stringify(args)}) → ${out.split('\n')[0].slice(0, 90)}`);
      messages.push({ role: 'tool', tool_call_id: c.id, content: out });
    }
  }
  const m = final.match(/RISPOSTA:\s*([-\d.,]+)/i) || final.match(/([-\d]+(?:[.,]\d+)?)(?!.*\d)/s);
  const n = m ? Number(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : NaN;
  return {
    id: task.id, ok: Number.isFinite(n) && Math.abs(n - task.risposta) < 0.51, risposta: Number.isFinite(n) ? n : null,
    passi: trace.length, token, secondi: Math.round((Date.now() - t0) / 100) / 10, trace: trace.slice(0, 12), finale: final.slice(-400),
  };
}

async function exam(g, tasks) {
  const out = [];
  for (const t of tasks) {
    try { out.push(await solve(g, t)); } catch (e) { out.push({ id: t.id, ok: false, risposta: null, errore: e.message, passi: 0, secondi: 0, trace: [] }); }
    log(`   ${g.nome.padEnd(10)} ${t.id} ${out.at(-1).ok ? '✓' : '✗'} (${out.at(-1).secondi}s)`);
  }
  return out;
}

/* ───────── mutazione riflessiva: impara da un errore ───────── */
async function reflect(parent) {
  const wrong = (parent.risultati || []).filter((r) => !r.ok);
  if (!wrong.length) return null;
  const r = pick(wrong);
  const task = ESAME.find((t) => t.id === r.id);
  const msg = await chat({
    // senza ragionamento: con "low" Qwen 3.5 può girare a vuoto per migliaia di token senza mai scrivere la regola
    temperature: 0.7, max_tokens: 300, reasoning_effort: 'none',
    messages: [{ role: 'user', content: `Un consulente di uno sportello affitti ha SBAGLIATO questo caso (non ti dico la risposta giusta).

Domanda: ${task.domanda}
Cosa ha fatto: ${r.trace.join(' | ') || 'nessuno strumento usato'}
La sua risposta finale: ${r.risposta ?? 'nessuna'}

Scrivi UNA sola regola di lavoro, generale e breve (massimo 25 parole), che lo avrebbe aiutato a non sbagliare.
Non citare numeri, nomi o dettagli di questo caso: deve valere per qualunque caso futuro.
Rispondi solo con la regola, su una riga.` }],
  });
  const text = String(msg.content || '').split('\n').map((x) => x.replace(/^[-*•\d.\s"]+|"$/g, '').trim()).find((x) => x.length > 10);
  return text ? text.slice(0, 220) : null;
}

// Mutazione "velocità": un caso risolto GIUSTO ma con tanti passi → una regola per arrivarci prima.
async function reflectSpeed(parent) {
  const slow = (parent.risultati || []).filter((r) => r.ok).sort((a, b) => b.secondi - a.secondi)[0];
  if (!slow) return null;
  const task = ESAME.find((t) => t.id === slow.id);
  const msg = await chat({
    temperature: 0.7, max_tokens: 300, reasoning_effort: 'none',
    messages: [{ role: 'user', content: `Un consulente di uno sportello affitti ha risolto GIUSTO questo caso, ma in modo lento: ${slow.passi} chiamate agli strumenti e ${slow.secondi} secondi.

Domanda: ${task.domanda}
Cosa ha fatto: ${slow.trace.join(' | ') || 'nessuno strumento usato'}

Scrivi UNA sola regola di lavoro, generale e breve (massimo 25 parole), per arrivare alla stessa risposta corretta con meno passi, senza rinunciare alla precisione.
Non citare numeri, nomi o dettagli di questo caso: deve valere per qualunque caso futuro.
Rispondi solo con la regola, su una riga.` }],
  });
  const text = String(msg.content || '').split('\n').map((x) => x.replace(/^[-*•\d.\s"]+|"$/g, '').trim()).find((x) => x.length > 10);
  return text ? text.slice(0, 220) : null;
}

/* ───────── accoppiamento ───────── */
async function breed(A, B, gen) {
  const personas = [A.persona, B.persona, A.persona === B.persona ? A.persona : `${A.persona} ${B.persona}`];
  const pool = [...A.regole, ...B.regole].filter((r, i, a) => a.findIndex((x) => x.testo === r.testo) === i);
  const regole = pool.filter(() => rand() < 0.65).slice(0, 5);
  const child = {
    nome: nextName(), gen, tipo: 'figlio', genitori: [A.id, B.id],
    persona: pick(personas),
    ragionamento: pick([A.ragionamento, B.ragionamento]),
    temperatura: Math.round(Math.min(1, Math.max(0, (A.temperatura + B.temperatura) / 2 + (rand() - 0.5) * 0.2)) * 100) / 100,
    passiMax: pick([A.passiMax || CFG.maxSteps, B.passiMax || CFG.maxSteps]),
    regole, mutazioni: [],
  };
  if (CFG.obiettivo === 'equilibrio' && rand() < 0.25) {
    const pm = Math.min(12, Math.max(4, child.passiMax + pick([-2, 2])));
    if (pm !== child.passiMax) { child.mutazioni.push(`passi massimi ${child.passiMax} → ${pm}`); child.passiMax = pm; }
  }
  if (rand() < 0.2) { const lv = pick(['none', 'low', 'medium']); if (lv !== child.ragionamento) { child.mutazioni.push(`ragionamento ${child.ragionamento} → ${lv}`); child.ragionamento = lv; } }
  if (rand() < 0.7) {
    // in "equilibrio" metà delle volte si impara dalla lentezza invece che dagli errori
    const speed = CFG.obiettivo === 'equilibrio' && rand() < 0.5;
    const teacher = speed ? pick([A, B]) : pick([A, B].filter((p) => p.risultati?.some((r) => !r.ok)).concat([A]));
    try {
      const rule = speed ? await reflectSpeed(teacher) : await reflect(teacher);
      if (rule) {
        child.regole = [...child.regole.slice(-4), { testo: rule, scopritore: child.nome, gen, tipo: speed ? 'velocità' : 'precisione' }];
        child.mutazioni.push(speed ? 'nuova regola per essere più veloce' : 'nuova regola imparata da un errore');
      } else log('   (mutazione: nessuna regola prodotta)');
    } catch (e) { log(`   (mutazione non riuscita: ${e.message})`); }
  }
  return child;
}

/* ───────── fronti di Pareto: più bravo E più veloce ───────── */
const dominates = (a, b) => a.voto >= b.voto && a.secondi <= b.secondi && (a.voto > b.voto || a.secondi < b.secondi);
function fronts(pool) {
  const out = [];
  let rest = [...pool];
  while (rest.length) {
    const f = rest.filter((a) => !rest.some((b) => dominates(b, a)));
    out.push(f);
    rest = rest.filter((a) => !f.includes(a));
  }
  return out;
}

/* ───────── salvataggio e visualizzazione ───────── */
const state = { creato: new Date().toISOString().slice(0, 16).replace('T', ' '), modello: CFG.model, config: CFG, stato: 'in corso', nodi: [], storia: [], esame: ESAME.map(({ id, domanda }) => ({ id, domanda })), segreto: SEGRETO.map(({ id, domanda }) => ({ id, domanda })), stats };
const logLines = [];
function log(t) { console.log(t); logLines.push(t); }

function save() {
  const nodes = state.nodi;
  const done = nodes.filter((n) => n.voto != null);
  const alpha = done.sort((a, b) => b.voto - a.voto || a.secondi - b.secondi)[0];
  state.alfa = alpha?.id ?? null;
  const lineage = new Set();
  const stack = alpha ? [alpha.id] : [];
  while (stack.length) { const i = stack.pop(); if (lineage.has(i)) continue; lineage.add(i); stack.push(...nodes[i].genitori); }
  for (const n of nodes) n.stirpe = lineage.has(n.id);
  const front = fronts(done)[0] || [];
  for (const n of nodes) n.pareto = front.includes(n);
  state.aggiornato = Date.now();
  fs.writeFileSync(path.join(OUT, 'risultati.json'), JSON.stringify(state, null, 1));
  const tpl = path.join(HERE, 'albero.template.html');
  if (fs.existsSync(tpl)) fs.writeFileSync(path.join(OUT, 'albero.html'), fs.readFileSync(tpl, 'utf8').replace('/*DATI*/null', JSON.stringify(state)));
}

async function evaluate(n) {
  n.risultati = await exam(n, ESAME);
  n.voto = n.risultati.filter((r) => r.ok).length / ESAME.length;
  n.secondi = Math.round(n.risultati.reduce((a, r) => a + r.secondi, 0) * 10) / 10;
  n.token = n.risultati.reduce((a, r) => a + (r.token || 0), 0);
  log(` → ${n.nome}: ${Math.round(n.voto * 100)}% in ${n.secondi}s`);
  save();
}

/* ───────── evoluzione ───────── */
if (process.argv.includes('--prova')) {
  // prova veloce: ogni fondatore su un solo caso
  for (const f of FONDATORI.slice(0, Number(arg('prova', 2)))) {
    const r = await solve({ ...f, regole: [] }, ESAME[0]);
    console.log(f.primer, r.ok ? 'OK' : 'NO', r.risposta, `${r.secondi}s`, r.passi, 'passi');
    for (const line of r.trace) console.log('   ' + line);
    console.log('   finale:', JSON.stringify(r.finale.slice(-150)));
  }
  process.exit(0);
}
const t0 = Date.now();
log(`🐺 Branco di agenti — ${CFG.model}, obiettivo «${CFG.obiettivo}», ${CFG.generations} generazioni, ${CFG.kidsPerGen} figli per generazione`);

const add = (n) => { n.id = state.nodi.length; n.scelto = false; state.nodi.push(n); return n; };
log('\n— Fondatori (PCR) —');
const founders = [];
// --riprendi <file>: riusa i fondatori già esaminati in una corsa precedente (stessi geni, stessi voti)
const resumeFile = arg('riprendi', null);
const previous = resumeFile ? JSON.parse(fs.readFileSync(path.resolve(HERE, resumeFile), 'utf8')).nodi.filter((n) => n.gen === 0 && n.voto != null) : [];
for (const f of FONDATORI) {
  const old = previous.find((p) => p.primer === f.primer);
  const n = add({ ...f, passiMax: CFG.maxSteps, nome: nextName(), gen: 0, tipo: 'fondatore', genitori: [], regole: [], mutazioni: [] });
  if (old) {
    Object.assign(n, { risultati: old.risultati, voto: old.voto, secondi: old.secondi, token: old.token ?? null });
    log(` → ${n.nome}: ${Math.round(n.voto * 100)}% in ${n.secondi}s (ripreso dalla corsa precedente)`);
    save();
  } else {
    save();
    await evaluate(n);
  }
  founders.push(n);
}
const rank = (arr) => [...arr].sort((a, b) => b.voto - a.voto || a.secondi - b.secondi);
// Selezione: per "intelligenza" i più bravi; per "equilibrio" il fronte di Pareto (nessuno è più bravo E più veloce di loro),
// scegliendo gli estremi del fronte (il più bravo, il più veloce) e uno in mezzo. Sotto una soglia di voto non si entra.
const floor = Math.max(...founders.map((f) => f.voto)) - 1 / ESAME.length;
function select(pool, k) {
  if (CFG.obiettivo !== 'equilibrio') return rank(pool).slice(0, k);
  const ok = pool.filter((n) => n.voto >= floor);
  const sel = [];
  for (const f of fronts(ok.length >= k ? ok : pool)) {
    const byV = rank(f);
    for (const n of [byV[0], byV.at(-1), byV[Math.floor(byV.length / 2)], ...byV]) if (sel.length < k && !sel.includes(n)) sel.push(n);
    if (sel.length >= k) break;
  }
  return sel;
}
let parents = select(founders, CFG.parents);
parents.forEach((p) => (p.scelto = true));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function genStats(gen, arr) {
  const best = rank(arr)[0];
  return { gen, migliore: best.voto, media: mean(arr.map((k) => k.voto)), tempoMigliore: best.secondi, tempoMedio: mean(arr.map((k) => k.secondi)), piuVeloce: Math.min(...arr.filter((k) => k.voto >= floor).map((k) => k.secondi).concat([Infinity])) };
}
state.storia.push(genStats(0, founders));
save();

for (let g = 1; g <= CFG.generations; g++) {
  log(`\n— Generazione ${g} — genitori: ${parents.map((p) => `${p.nome} ${Math.round(p.voto * 100)}% ${Math.round(p.secondi)}s`).join(', ')}`);
  const couples = [];
  for (let i = 0; i < parents.length; i++) for (let j = i + 1; j < parents.length; j++) couples.push([parents[i], parents[j]]);
  const kids = [];
  for (let k = 0; k < CFG.kidsPerGen; k++) {
    const [A, B] = couples[k % couples.length];
    const child = add(await breed(A, B, g));
    log(` ${child.nome} = ${A.nome} × ${B.nome}${child.mutazioni.length ? ` · ${child.mutazioni.join(', ')}` : ''}`);
    if (child.regole.at(-1)?.scopritore === child.nome) log(`   nuova regola: «${child.regole.at(-1).testo}»`);
    save();
    await evaluate(child);
    kids.push(child);
  }
  parents = select([...kids, ...parents], CFG.parents);
  parents.forEach((p) => (p.scelto = true));
  state.storia.push(genStats(g, kids));
  save();
}

// esame segreto: alfa contro il miglior fondatore (le stesse domande nuove per entrambi)
const alpha = rank(state.nodi.filter((n) => n.voto != null))[0];
const bestFounder = rank(founders)[0];
log(`\n— Esame segreto — ${alpha.nome} (alfa) contro ${bestFounder.nome} (miglior fondatore)`);
for (const n of alpha === bestFounder ? [alpha] : [alpha, bestFounder]) {
  n.segreto = await exam(n, SEGRETO);
  n.votoSegreto = n.segreto.filter((r) => r.ok).length / SEGRETO.length;
  log(` → ${n.nome}: ${Math.round(n.votoSegreto * 100)}%`);
}
state.stato = 'finito';
state.minuti = Math.round((Date.now() - t0) / 6000) / 10;
save();
log(`\nFatto in ${state.minuti} minuti · ${stats.chiamate} chiamate al modello · ${stats.token} token generati`);
log(`ALFA: ${alpha.nome} (gen ${alpha.gen}) ${Math.round(alpha.voto * 100)}% · segreto ${Math.round((alpha.votoSegreto ?? 0) * 100)}%`);
