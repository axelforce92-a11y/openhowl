// Automazioni a orario: compiti che Howl esegue da solo, anche quando non stai guardando.
//
// I compiti stanno in ~/.openhowl/tasks.json. Ogni esecuzione:
//  - parte in una conversazione tutta sua (la ritrovi nella barra laterale),
//  - lavora senza chiedere permessi (nessuno è davanti allo schermo) ma rifiuta le azioni pericolose,
//  - finisce con un riassunto che arriva come notifica e come scheda nell'interfaccia.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './config.js';
import { Agent } from './agent.js';
import { buildSystemPrompt } from './prompt.js';
import { newSession, saveSession } from './sessions.js';

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const TICK_MS = 30000;          // ogni quanto il pianificatore guarda l'orologio
const CATCHUP_MS = 12 * 3600e3; // recupera un appuntamento mancato (PC spento) solo se è saltato da meno di 12 ore
const MAX_RUNS = 20;            // esecuzioni tenute nello storico di ogni compito

/* ───────── archivio ───────── */

export function loadTasks() {
  try {
    const d = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    return Array.isArray(d?.tasks) ? d.tasks : [];
  } catch { return []; }
}

function writeTasks(tasks) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks }, null, 2));
}

/* ───────── quando ───────── */

const DAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
// Parole intere: "giorno" non deve diventare giovedì, né "marzo" martedì.
const DAY_KEYS = [
  [/\b(domenic\w*|dom|sunday|sun)\b/, 0],
  [/\b(luned\w*|lun|monday|mon)\b/, 1],
  [/\b(marted\w*|mar|tuesday|tue)\b/, 2],
  [/\b(mercoled\w*|mer|wednesday|wed)\b/, 3],
  [/\b(gioved\w*|gio|thursday|thu)\b/, 4],
  [/\b(venerd\w*|ven|friday|fri)\b/, 5],
  [/\b(sabato|sab|saturday|sat)\b/, 6],
];

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(Math.min(23, Math.max(0, h)))}:${pad(Math.min(59, Math.max(0, m || 0)))}`;

// Estrae "alle 8", "alle 08:30", "ore 20.15" → "08:30". Senza orario: null.
function findTime(s) {
  const m = s.match(/\b(?:alle|alle ore|ore|at)\s*(\d{1,2})(?:[:.](\d{2}))?\b/) || s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  return hhmm(Number(m[1]), Number(m[2] || 0));
}

function findDays(s) {
  const out = new Set();
  for (const [re, n] of DAY_KEYS) if (re.test(s)) out.add(n);
  return [...out].sort((a, b) => a - b);
}

// Trasforma una frase ("ogni mattina alle 8", "ogni 30 minuti", "domani alle 18") in una pianificazione.
export function parseWhen(input) {
  const s = String(input || '').toLowerCase().trim();
  if (!s) return null;
  const now = new Date();

  // ogni N minuti / ore
  const every = s.match(/\bogni\s+(\d+)\s*(min|minut\w*|h|or[ae]|hours?|minutes?)\b/) || s.match(/\bevery\s+(\d+)\s*(m|min\w*|h|hours?)\b/);
  if (every) {
    const n = Number(every[1]);
    const isHour = /^(h|or|hour)/.test(every[2]);
    return { kind: 'interval', everyMin: Math.max(1, isHour ? n * 60 : n) };
  }

  // tra N minuti / ore  → una volta sola
  const inN = s.match(/\b(?:tra|fra|in)\s+(\d+)\s*(min\w*|h|or[ae]|hours?|minutes?)\b/);
  if (inN) {
    const n = Number(inN[1]);
    const ms = (/^(h|or|hour)/.test(inN[2]) ? 60 : 1) * n * 60000;
    return { kind: 'once', at: Date.now() + ms };
  }

  const time = findTime(s);

  // oggi / domani / stasera alle HH:MM → una volta sola
  if (/\b(domani|tomorrow|oggi|today|stasera|stamattina)\b/.test(s)) {
    const d = new Date(now);
    if (/\b(domani|tomorrow)\b/.test(s)) d.setDate(d.getDate() + 1);
    const [h, m] = (time || (/stasera/.test(s) ? '20:00' : '09:00')).split(':').map(Number);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return { kind: 'once', at: d.getTime() };
  }

  // il 25/12 [alle 9] → una volta sola
  const date = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (date && !/\bogni\b/.test(s)) {
    const y = date[3] ? Number(date[3].length === 2 ? `20${date[3]}` : date[3]) : now.getFullYear();
    const [h, m] = (time || '09:00').split(':').map(Number);
    const d = new Date(y, Number(date[2]) - 1, Number(date[1]), h, m, 0, 0);
    if (d.getTime() > Date.now()) return { kind: 'once', at: d.getTime() };
  }

  const days = findDays(s);
  if (days.length) return { kind: 'weekly', time: time || '09:00', days };

  if (/\b(ogni|tutti i|every|daily|mattina|sera|pomeriggio|notte)\b/.test(s) || time) {
    const def = /\bsera\b/.test(s) ? '20:00' : /\bpomeriggio\b/.test(s) ? '15:00' : /\bnotte\b/.test(s) ? '23:00' : '08:00';
    return { kind: 'daily', time: time || def };
  }
  return null;
}

// Normalizza una pianificazione che arriva dall'interfaccia o dal modello.
export function normalizeSchedule(sch) {
  if (!sch) return null;
  if (typeof sch === 'string') return parseWhen(sch);
  const kind = String(sch.kind || '').toLowerCase();
  if (kind === 'interval') return { kind, everyMin: Math.max(1, Math.round(Number(sch.everyMin) || 60)) };
  if (kind === 'once') {
    const at = typeof sch.at === 'number' ? sch.at : Date.parse(sch.at);
    return Number.isFinite(at) ? { kind, at } : null;
  }
  const time = /^\d{1,2}:\d{2}$/.test(sch.time || '') ? hhmm(...sch.time.split(':').map(Number)) : '08:00';
  if (kind === 'weekly') {
    const days = (Array.isArray(sch.days) ? sch.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
    return { kind, time, days: days.length ? [...new Set(days)].sort() : [1] };
  }
  if (kind === 'daily') return { kind, time };
  return null;
}

// Prossimo appuntamento dopo "from" (millisecondi), oppure null se non ce ne sono più.
export function nextRun(sch, from = Date.now()) {
  if (!sch) return null;
  if (sch.kind === 'once') return sch.at > from ? sch.at : null;
  if (sch.kind === 'interval') return from + sch.everyMin * 60000;
  const [h, m] = String(sch.time || '08:00').split(':').map(Number);
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  if (sch.kind === 'weekly') {
    const days = sch.days?.length ? sch.days : [1];
    for (let i = 0; i < 7 && !days.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

export function describe(sch) {
  if (!sch) return '—';
  if (sch.kind === 'interval') {
    if (sch.everyMin === 60) return 'ogni ora';
    if (sch.everyMin > 60 && sch.everyMin % 60 === 0) return `ogni ${sch.everyMin / 60} ore`;
    return `ogni ${sch.everyMin} minut${sch.everyMin === 1 ? 'o' : 'i'}`;
  }
  if (sch.kind === 'once') return `una volta, il ${new Date(sch.at).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`;
  if (sch.kind === 'weekly') return `ogni ${sch.days.map((d) => DAY_NAMES[d]).join(', ')} alle ${sch.time}`;
  return `ogni giorno alle ${sch.time}`;
}

/* ───────── esecuzione ───────── */

// L'agente in esecuzione crede di parlare con l'harness normale, ma scrive nella conversazione
// del compito invece che nella chat aperta, e decide i permessi da solo (nessuno può rispondere).
function taskHarness(h, run) {
  return new Proxy(h, {
    get(t, k) {
      switch (k) {
        case 'send': return (type, data = {}) => run.event(type, data);
        case 'setTodos': return (items) => { run.todos = items; run.event('todo', { items }); };
        case 'setContext': return () => {};
        // il conteggio dei token resta globale, ma non entra nella conversazione aperta
        case 'addUsage': return (u = {}) => {
          t.usage.input += u.input || 0;
          t.usage.output += u.output || 0;
          t.broadcast('usage', { usage: t.usage });
        };
        case 'cfg': return run.cfg;
        case 'approve': return async ({ name, input, risk }) => {
          if (risk === 'read') return true;
          if (run.cfg.mode === 'readonly') return false;
          if (t.isDangerous(name, input)) {
            run.event('info', { text: `⛔ Azione pericolosa rifiutata: in un'automazione non c'è nessuno che possa confermare (\`${name}\`).` });
            return false;
          }
          return true;
        };
        case 'waitForUser': return async ({ title, message }) => {
          run.event('info', { text: `⏸ Servirebbe il tuo intervento (${title}: ${message}), ma questa è un'automazione: mi fermo qui.` });
          return 'cancel';
        };
        default: {
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        }
      }
    },
  });
}

const RUN_PROMPT = (task) => `[AUTOMAZIONE PROGRAMMATA — "${task.name}"]
Ora locale: ${new Date().toLocaleString('it-IT')}

COMPITO DA SVOLGERE:
${task.prompt}

Lavora in completa autonomia: l'utente NON è davanti allo schermo e nessuno può rispondere alle domande.
Prendi da solo le decisioni ragionevoli e annotale. Non chiedere conferme.
Verifica ciò che fai (rileggi i file, controlla gli output).
Chiudi SEMPRE con un riassunto breve e concreto di cosa hai trovato o fatto: è l'unica cosa che l'utente leggerà.`;

export class Scheduler {
  constructor(harness) {
    this.h = harness;
    this.tasks = loadTasks();
    this.timer = null;
    this.running = null; // { taskId, abort, startedAt }
    this.reschedule(true);
  }

  /* ── stato ── */

  save() {
    writeTasks(this.tasks);
    this.broadcast();
  }

  broadcast() {
    this.h.broadcast('tasks', { tasks: this.publicTasks(), running: this.running?.taskId || null });
  }

  publicTasks() {
    return this.tasks.map((t) => ({
      id: t.id, name: t.name, prompt: t.prompt, schedule: t.schedule, when: describe(t.schedule),
      enabled: t.enabled, mode: t.mode, notify: t.notify, nextRun: t.enabled ? t.nextRun : null,
      lastRun: t.lastRun || null, lastStatus: t.lastStatus || null, lastReport: t.lastReport || null,
      lastSessionId: t.lastSessionId || null, runs: (t.runs || []).slice(-5).reverse(),
    }));
  }

  find(ref) {
    const s = String(ref || '').trim().toLowerCase();
    if (!s) return null;
    return this.tasks.find((t) => t.id === s)
      || this.tasks.find((t) => t.name.toLowerCase() === s)
      || this.tasks.find((t) => t.name.toLowerCase().includes(s))
      || null;
  }

  // Ricalcola i prossimi appuntamenti. Al primo avvio recupera quelli saltati da poco (PC spento).
  reschedule(startup = false) {
    const now = Date.now();
    for (const t of this.tasks) {
      if (!t.enabled) continue;
      if (t.schedule.kind === 'once' && t.lastRun) { t.enabled = false; continue; }
      if (!t.nextRun || t.nextRun > now) { t.nextRun ||= nextRun(t.schedule, now); continue; }
      if (!startup) continue; // è già dovuto: ci pensa il prossimo giro dell'orologio
      // appuntamento mancato mentre il computer era spento: se è recente lo recuperiamo, altrimenti si salta
      t.nextRun = (t.catchUp !== false && now - t.nextRun < CATCHUP_MS) ? now + 20000 : nextRun(t.schedule, now);
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    this.timer.unref?.();
    this.tick().catch(() => {});
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.running?.abort.abort();
  }

  /* ── ciclo ── */

  async tick() {
    if (this.running || this.h.busy) return; // un compito alla volta, e mai mentre stai lavorando con Howl
    const now = Date.now();
    const due = this.tasks.filter((t) => t.enabled && t.nextRun && t.nextRun <= now).sort((a, b) => a.nextRun - b.nextRun)[0];
    if (due) await this.execute(due, 'schedule');
  }

  async execute(task, trigger = 'manual') {
    if (this.running) throw new Error(`Sto già eseguendo l'automazione "${this.find(this.running.taskId)?.name || '?'}".`);
    const abort = new AbortController();
    this.running = { taskId: task.id, abort, startedAt: Date.now() };

    const session = newSession();
    session.title = `🕗 ${task.name}`;
    session.task = { id: task.id, trigger };
    const run = {
      cfg: { ...this.h.cfg, mode: task.mode === 'readonly' ? 'readonly' : 'auto' },
      todos: [],
      event: (type, data = {}) => {
        const ev = { type, ts: Date.now(), ...data };
        if (!type.endsWith('_delta')) {
          session.log.push(ev);
          if (session.log.length > 600) session.log.splice(0, session.log.length - 600);
        }
        // avanzamento in diretta verso l'interfaccia, senza finire nella chat aperta
        if (type === 'tool_start') this.h.broadcast('task_progress', { taskId: task.id, tool: ev.name });
        else if (type === 'state' && ev.state === 'thinking') this.h.broadcast('task_progress', { taskId: task.id, tool: null });
      },
    };

    this.h.broadcast('task_started', { taskId: task.id, name: task.name, sessionId: session.id, trigger });
    const t0 = Date.now();
    let ok = false;
    let report = '';
    try {
      const proxy = taskHarness(this.h, run);
      const agent = new Agent({
        harness: proxy,
        name: `task:${task.name.slice(0, 20)}`,
        tools: this.h.allTools(),
        systemPrompt: () => buildSystemPrompt(proxy, '\n# Modalità automazione\nStai eseguendo un compito programmato senza nessuno davanti allo schermo: non fare domande, non attendere conferme, chiudi con un riassunto utile.'),
        maxSteps: task.maxSteps || 40,
      });
      report = (await agent.run(RUN_PROMPT(task), { signal: abort.signal })) || '(nessun riassunto)';
      ok = true;
    } catch (e) {
      report = e.name === 'AbortError' ? 'Automazione interrotta.' : `Automazione fallita: ${e.message}`;
      run.event('error', { text: report });
    } finally {
      const ms = Date.now() - t0;
      session.todos = run.todos;
      session.updatedAt = Date.now();
      try { saveSession(session); } catch {}

      task.lastRun = Date.now();
      task.lastStatus = ok ? 'ok' : 'error';
      task.lastReport = report.slice(0, 4000);
      task.lastSessionId = session.id;
      task.runs = [...(task.runs || []), { at: task.lastRun, ok, ms, trigger, sessionId: session.id, report: report.slice(0, 600) }].slice(-MAX_RUNS);
      if (task.schedule.kind === 'once') task.enabled = false;
      else task.nextRun = nextRun(task.schedule, Date.now());
      this.running = null;
      this.save();
      this.h.broadcast('task_done', {
        taskId: task.id, name: task.name, ok, ms, report: task.lastReport,
        sessionId: session.id, notify: task.notify !== false,
      });
      this.h.sendSessions();
    }
    return { ok, report, sessionId: session.id };
  }

  /* ── modifiche ── */

  create(input) {
    const schedule = normalizeSchedule(input.schedule ?? input.when);
    if (!schedule) throw new Error('Non ho capito quando eseguirlo. Esempi: "ogni giorno alle 8:00", "ogni lunedì alle 9:30", "ogni 30 minuti", "domani alle 18".');
    const prompt = String(input.prompt || '').trim();
    if (!prompt) throw new Error('Manca il compito da svolgere.');
    const task = {
      id: randomUUID().slice(0, 8),
      name: String(input.name || prompt).replace(/\s+/g, ' ').trim().slice(0, 60) || 'Automazione',
      prompt,
      schedule,
      enabled: input.enabled !== false,
      mode: input.mode === 'readonly' ? 'readonly' : 'auto',
      notify: input.notify !== false,
      catchUp: input.catchUp !== false,
      maxSteps: Math.min(120, Math.max(5, Number(input.maxSteps) || 40)),
      createdAt: Date.now(),
      nextRun: nextRun(schedule),
      runs: [],
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  update(id, patch) {
    const t = this.find(id);
    if (!t) throw new Error('Automazione non trovata.');
    if (patch.name !== undefined) t.name = String(patch.name).slice(0, 60) || t.name;
    if (patch.prompt !== undefined && String(patch.prompt).trim()) t.prompt = String(patch.prompt).trim();
    if (patch.mode !== undefined) t.mode = patch.mode === 'readonly' ? 'readonly' : 'auto';
    if (patch.notify !== undefined) t.notify = !!patch.notify;
    if (patch.maxSteps !== undefined) t.maxSteps = Math.min(120, Math.max(5, Number(patch.maxSteps) || 40));
    if (patch.schedule !== undefined || patch.when !== undefined) {
      const sch = normalizeSchedule(patch.schedule ?? patch.when);
      if (!sch) throw new Error('Pianificazione non valida.');
      t.schedule = sch;
      t.nextRun = nextRun(sch);
    }
    if (patch.enabled !== undefined) {
      t.enabled = !!patch.enabled;
      if (t.enabled) t.nextRun = nextRun(t.schedule);
    }
    this.save();
    return t;
  }

  remove(id) {
    const t = this.find(id);
    if (!t) return false;
    this.tasks = this.tasks.filter((x) => x.id !== t.id);
    this.save();
    return true;
  }
}

/* ───────── strumento: Howl programma le automazioni da solo ───────── */

export const scheduleTool = {
  name: 'schedule_task',
  description: 'Programma un compito che eseguirai da solo a un certo orario, anche quando l\'utente non c\'è (es. "ogni mattina alle 8 controlla le novità e scrivi il riassunto"). Usalo quando l\'utente chiede qualcosa di ricorrente o differito nel tempo. Con action "list" elenchi le automazioni, "delete" ne cancelli una, "run" la esegui subito.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'delete', 'enable', 'disable', 'run'], description: 'predefinito: create' },
      name: { type: 'string', description: 'nome breve, es. "Rassegna stampa AI"' },
      prompt: { type: 'string', description: 'il compito completo, scritto come lo daresti a te stesso in futuro: chi lo eseguirà non ha nessun altro contesto' },
      when: { type: 'string', description: 'quando eseguirlo, in parole: "ogni giorno alle 8:00", "ogni lunedì e giovedì alle 9:30", "ogni 30 minuti", "domani alle 18"' },
      mode: { type: 'string', enum: ['auto', 'readonly'], description: 'auto (predefinito) agisce; readonly può solo leggere e cercare' },
      id: { type: 'string', description: 'id o nome dell\'automazione, per delete/enable/disable/run' },
    },
    required: [],
  },
  risk: (input) => (!input.action || input.action === 'list' ? 'read' : 'write'),
  async run(input, ctx) {
    const sched = ctx.h.scheduler;
    if (!sched) throw new Error('Pianificatore non disponibile.');
    const action = input.action || 'create';
    if (action === 'list') {
      const list = sched.publicTasks();
      return list.length
        ? list.map((t) => `- [${t.enabled ? 'attiva' : 'in pausa'}] ${t.name} (id ${t.id}) — ${t.when}${t.nextRun ? `, prossima ${new Date(t.nextRun).toLocaleString('it-IT')}` : ''}`).join('\n')
        : 'Nessuna automazione programmata.';
    }
    if (action === 'create') {
      const t = sched.create(input);
      return `Automazione "${t.name}" creata (id ${t.id}): ${describe(t.schedule)}. Prima esecuzione: ${new Date(t.nextRun).toLocaleString('it-IT')}.`;
    }
    const t = sched.find(input.id || input.name);
    if (!t) throw new Error(`Automazione "${input.id || input.name}" non trovata.`);
    if (action === 'delete') { sched.remove(t.id); return `Automazione "${t.name}" eliminata.`; }
    if (action === 'enable' || action === 'disable') {
      sched.update(t.id, { enabled: action === 'enable' });
      return `Automazione "${t.name}" ${action === 'enable' ? `riattivata: prossima esecuzione ${new Date(t.nextRun).toLocaleString('it-IT')}` : 'messa in pausa'}.`;
    }
    if (action === 'run') {
      const r = await sched.execute(t, 'manual');
      return `Eseguita "${t.name}" (${r.ok ? 'ok' : 'con errori'}).\n\n${r.report}`;
    }
    throw new Error(`Azione sconosciuta: ${action}`);
  },
};
