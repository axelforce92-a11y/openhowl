// Harness: collega agente, strumenti, permessi, comandi slash, goal loop ed eventi verso le interfacce (web e CLI).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRESETS, providerInfo, loadBrains, saveBrains } from './config.js';

export const MASK = '••••••••';
const maskBrain = (b) => ({ ...b, apiKey: b.apiKey ? MASK : '' });
import { Agent } from './agent.js';
import { GoalRunner } from './goal.js';
import { builtinTools, MEMORY_FILE } from './tools/index.js';
import { isDangerousCommand } from './tools/shell.js';
import { buildSystemPrompt } from './prompt.js';
import { McpClient } from './mcp.js';
import { resolveUserPath } from './paths.js';
import { newSession, saveSession, loadSession, deleteSession, listSessions, titleFrom } from './sessions.js';
import { ensureDefaults, listSkills, matchSkills, SOUL_FILE, SKILLS_DIR } from './skills.js';
import { loadHooks, runHook, HOOKS_DIR } from './hooks.js';
import { Scheduler, describe as describeSchedule, parseWhen } from './schedule.js';

export const COMMANDS = [
  ['/goal <obiettivo> [--max N]', 'Loop engineering: pianifica → esegue → verifica → ripete fino al risultato'],
  ['/goal status', 'Stato del goal corrente'],
  ['/goal resume [--max N]', 'Riprende l\'ultimo goal non completato'],
  ['/stop', 'Interrompe il lavoro in corso'],
  ['/mode ask|auto|readonly', 'Permessi: chiedi / autonomo / sola lettura'],
  ['/brain [nome]', 'Elenca o attiva un modello salvato'],
  ['/skills', 'Elenca le skill che Howl sa usare'],
  ['/soul', 'Dove modificare identità e carattere di Howl'],
  ['/hooks [reload]', 'Elenca o ricarica gli hook'],
  ['/task', 'Elenca le automazioni a orario'],
  ['/task add <quando> :: <compito>', 'Nuova automazione, es. `/task add ogni giorno alle 8 :: controlla le novità AI e scrivimi il riassunto`'],
  ['/task run|on|off|del|log <id>', 'Esegui adesso, attiva, metti in pausa, elimina o mostra lo storico'],
  ['/provider <nome>', `Cambia provider (${Object.keys(PRESETS).join(', ')})`],
  ['/model <id>', 'Cambia modello'],
  ['/cwd <percorso>', 'Cambia cartella di lavoro'],
  ['/tools', 'Elenca gli strumenti'],
  ['/memory', 'Mostra la memoria persistente'],
  ['/compact', 'Riassume il contesto per liberare spazio'],
  ['/clear', 'Nuova conversazione'],
  ['/help', 'Questo aiuto'],
];

export class Harness {
  constructor(cfg) {
    this.cfg = cfg;
    this.listeners = new Set();
    this.log = [];
    this.usage = { input: 0, output: 0 };
    this.pending = new Map();
    this.alwaysAllow = new Set();
    this.todos = [];
    this.busy = false;
    this.abort = null;
    this.mcpTools = [];
    this.mcpClients = [];
    this.goal = new GoalRunner(this);
    this.agent = this.newMainAgent();
    this.session = newSession();
    this.context = { tokens: 0, limit: this.limits.contextLimit };
    this.saveTimer = null;
  }

  /* ── Storico conversazioni ── */

  persist() {
    if (!this.session) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.session.messages = this.agent.messages;
      this.session.log = this.log;
      this.session.todos = this.todos;
      this.session.goal = this.goal.state;
      this.session.usage = this.usage;
      this.session.context = this.context;
      this.session.updatedAt = Date.now();
      try { saveSession(this.session); } catch {}
    }, 800);
  }

  sendSessions() {
    const list = listSessions();
    if (!list.some((s) => s.id === this.session.id)) list.unshift({ id: this.session.id, title: this.session.title, updatedAt: Date.now(), messages: this.agent.messages.length });
    // l'elenco delle conversazioni è già nello snapshot: non serve tenerlo anche nel log della chat
    this.broadcast('sessions', { sessions: list, current: this.session.id });
  }

  newChat() {
    this.stop();
    this.persist();
    clearTimeout(this.saveTimer);
    if (this.agent.messages.length) { this.session.messages = this.agent.messages; this.session.log = this.log; saveSession(this.session); }
    this.session = newSession();
    this.agent = this.newMainAgent();
    this.log = [];
    this.todos = [];
    this.usage = { input: 0, output: 0 };
    this.context = { tokens: 0, limit: this.limits.contextLimit };
    this.goal.state = null;
    this.alwaysAllow.clear();
    this.send('clear');
    this.sendSessions();
  }

  openSession(id) {
    if (id === this.session.id) return;
    if (this.busy) { this.send('info', { text: 'Sto lavorando: premi Interrompi prima di cambiare conversazione.' }); return; }
    const s = loadSession(id);
    if (!s) { this.send('error', { text: 'Conversazione non trovata.' }); return; }
    this.persist();
    clearTimeout(this.saveTimer);
    if (this.agent.messages.length) { this.session.messages = this.agent.messages; this.session.log = this.log; saveSession(this.session); }
    this.session = s;
    this.agent = this.newMainAgent();
    this.agent.messages = s.messages || [];
    this.log = s.log || [];
    this.todos = s.todos || [];
    this.usage = s.usage || { input: 0, output: 0 };
    this.context = s.context || { tokens: 0, limit: this.limits.contextLimit };
    this.goal.state = s.goal || null;
    this.alwaysAllow.clear();
    for (const fn of this.listeners) { try { fn({ type: 'snapshot', ...this.snapshot() }); } catch {} }
    this.sendSessions();
  }

  removeSession(id) {
    deleteSession(id);
    if (id === this.session.id) this.newChat();
    else this.sendSessions();
  }

  renameSession(id, title) {
    const t = String(title || '').trim().slice(0, 80);
    if (!t) return;
    if (id === this.session.id) { this.session.title = t; this.persist(); }
    else { const s = loadSession(id); if (s) { s.title = t; saveSession(s); } }
    this.sendSessions();
  }

  setContext(tokens) {
    this.context = { tokens, limit: this.limits.contextLimit };
    this.send('context', { context: this.context });
  }

  async init() {
    ensureDefaults();
    this.hooks = await loadHooks(this);
    if (this.hooks.length) this.send('info', { text: `Hook attivi: ${this.hooks.map((h) => `\`${h.name}\``).join(', ')}` });
    for (const [name, conf] of Object.entries(this.cfg.mcpServers)) {
      try {
        const client = new McpClient(name, conf);
        const tools = await client.connect();
        this.mcpClients.push(client);
        this.mcpTools.push(...tools);
        this.send('info', { text: `MCP "${name}" connesso: ${tools.length} strumenti` });
      } catch (e) {
        this.send('error', { text: `MCP "${name}" non disponibile: ${e.message}` });
      }
    }
    this.agent.tools = this.allTools();
    this.scheduler = new Scheduler(this);
    this.scheduler.start();
    const next = this.scheduler.publicTasks().filter((t) => t.nextRun).sort((a, b) => a.nextRun - b.nextRun)[0];
    if (next) this.send('info', { text: `🕗 Automazioni attive: ${this.scheduler.tasks.filter((t) => t.enabled).length}. Prossima: **${next.name}** ${new Date(next.nextRun).toLocaleString('it-IT')}` });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  send(type, data = {}) {
    const ev = { type, ts: Date.now(), ...data };
    if (!type.endsWith('_delta')) {
      this.log.push(ev);
      if (this.log.length > 800) this.log.splice(0, this.log.length - 800);
    }
    for (const fn of this.listeners) { try { fn(ev); } catch {} }
    if (!type.endsWith('_delta')) this.persist();
  }

  // Evento verso le interfacce che NON entra nella conversazione aperta (avanzamento delle automazioni).
  broadcast(type, data = {}) {
    const ev = { type, ts: Date.now(), ...data };
    for (const fn of this.listeners) { try { fn(ev); } catch {} }
  }

  allTools() { return [...builtinTools(), ...this.mcpTools]; }
  providerInfo() { return providerInfo(this.cfg); }

  newMainAgent() {
    return new Agent({ harness: this, name: 'main', tools: this.allTools(), systemPrompt: () => buildSystemPrompt(this), maxSteps: this.cfg.maxSteps });
  }

  get limits() {
    const b = this.cfg.brain;
    return {
      maxTokens: Number(b?.maxTokens) || this.cfg.maxTokens,
      contextLimit: Number(b?.contextLimit) || this.cfg.contextLimit,
      thinkingBudget: b ? 0 : this.cfg.thinkingBudget,
    };
  }

  publicConfig() {
    const p = this.providerInfo();
    const brains = loadBrains();
    return {
      provider: this.cfg.provider, model: p.model, mode: this.cfg.mode, workspace: this.cfg.workspace,
      hasKey: !!p.apiKey, keyEnv: p.keyEnv, providers: Object.keys(PRESETS), vision: p.vision,
      brain: this.cfg.brain ? { id: this.cfg.brain.id, name: this.cfg.brain.name } : null,
      brains: brains.list.map(maskBrain),
      tools: this.allTools().map((t) => t.name),
    };
  }

  /* ── Cervelli ── */

  saveBrain(input, activate = false) {
    const store = loadBrains();
    const old = store.list.find((b) => b.id === input.id);
    const brain = {
      id: old?.id || `b${Date.now().toString(36)}`,
      name: String(input.name || input.model || 'Cervello').slice(0, 60),
      kind: input.kind === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: String(input.baseUrl || '').trim().replace(/\/$/, ''),
      apiKey: input.apiKey === MASK ? old?.apiKey || '' : String(input.apiKey || '').trim(),
      model: String(input.model || '').trim(),
      vision: !!input.vision,
      contextLimit: Number(input.contextLimit) || 32000,
      maxTokens: Number(input.maxTokens) || 4096,
      echoReasoning: !!input.echoReasoning,
    };
    if (!brain.baseUrl || !brain.model) throw new Error('Servono almeno indirizzo (base URL) e modello.');
    store.list = old ? store.list.map((b) => (b.id === brain.id ? brain : b)) : [...store.list, brain];
    saveBrains(store);
    if (activate || this.cfg.brain?.id === brain.id) this.activateBrain(brain.id);
    else this.send('config', { config: this.publicConfig() });
    return brain;
  }

  resolveBrainInput(input) {
    const old = loadBrains().list.find((b) => b.id === input.id);
    return { ...input, apiKey: input.apiKey === MASK ? old?.apiKey || '' : input.apiKey };
  }

  deleteBrain(id) {
    const store = loadBrains();
    store.list = store.list.filter((b) => b.id !== id);
    if (store.active === id) { store.active = null; this.cfg.brain = null; }
    saveBrains(store);
    this.send('config', { config: this.publicConfig() });
  }

  activateBrain(id) {
    const store = loadBrains();
    const brain = store.list.find((b) => b.id === id);
    if (!brain) throw new Error('Cervello non trovato');
    store.active = id;
    saveBrains(store);
    this.cfg.brain = brain;
    this.send('config', { config: this.publicConfig() });
    this.send('info', { text: `🧠 Cervello attivo: **${brain.name}** — \`${brain.model}\` (${brain.baseUrl})` });
  }

  snapshot() {
    return {
      config: this.publicConfig(), log: this.log, goal: this.goal.state, todos: this.todos,
      usage: this.usage, context: this.context, busy: this.busy, commands: COMMANDS,
      sessions: listSessions(), session: { id: this.session.id, title: this.session.title },
      tasks: this.scheduler?.publicTasks() || [], taskRunning: this.scheduler?.running?.taskId || null,
    };
  }

  addUsage(u = {}) {
    this.usage.input += u.input || 0;
    this.usage.output += u.output || 0;
    this.send('usage', { usage: this.usage });
  }

  setTodos(items) {
    this.todos = items;
    this.send('todo', { items });
  }

  /* ── Permessi ── */

  isDangerous(name, input) {
    if (name === 'run_command') return isDangerousCommand(input.command);
    if (name === 'write_file' || name === 'edit_file') {
      const rel = path.relative(this.cfg.workspace, resolveUserPath(this.cfg.workspace, input.path || ''));
      return rel.startsWith('..') || path.isAbsolute(rel);
    }
    return false;
  }

  async approve({ name, input, risk, agent }) {
    const danger = this.isDangerous(name, input);
    if (this.cfg.mode === 'readonly' && risk !== 'read') return false;
    if (!danger && (risk === 'read' || this.cfg.mode === 'auto' || this.alwaysAllow.has(name))) return true;
    const id = randomUUID();
    this.send('state', { state: 'approval' });
    this.send('approval_request', { id, name, input, risk, danger, agent });
    const res = await new Promise((resolve) => this.pending.set(id, resolve));
    this.send('approval_resolved', { id, allow: res.allow });
    if (res.allow && res.always && !danger) this.alwaysAllow.add(name);
    return res.allow;
  }

  resolveApproval(id, allow, always = false) {
    const r = this.pending.get(id);
    if (!r) return;
    this.pending.delete(id);
    r({ allow, always });
  }

  /* ── Azioni che solo l'utente può fare (es. verifica "non sono un robot") ── */

  // Mette in pausa l'agente finché l'utente non completa l'azione. Si sblocca quando:
  // l'utente preme Continua/Annulla, oppure check() rileva che è fatto, oppure si interrompe, oppure scade.
  async waitForUser({ title, message, url, check, agent, timeoutMs = 10 * 60 * 1000 }) {
    const id = randomUUID();
    this.userActions ??= new Map();
    this.send('state', { state: 'approval' });
    this.send('user_action_request', { id, title, message, url, agent });
    const outcome = await new Promise((resolve) => {
      let timer, poll;
      const finish = (r) => { clearTimeout(timer); clearInterval(poll); this.userActions.delete(id); resolve(r); };
      this.userActions.set(id, finish);
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      if (check) {
        let busyCheck = false;
        poll = setInterval(async () => {
          if (busyCheck) return;
          busyCheck = true;
          try { if (await check()) finish('done'); } catch {} finally { busyCheck = false; }
        }, 2000);
      }
    });
    this.send('user_action_resolved', { id, outcome });
    this.send('state', { state: 'thinking', agent });
    return outcome;
  }

  resolveUserAction(id, outcome) {
    this.userActions?.get(id)?.(outcome === 'done' ? 'done' : 'cancel');
  }

  stop() {
    this.abort?.abort();
    for (const id of [...this.pending.keys()]) this.resolveApproval(id, false);
    for (const id of [...(this.userActions?.keys() || [])]) this.resolveUserAction(id, 'cancel');
  }

  /* ── Input ── */

  async handleInput(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    if (text.startsWith('/')) return this.command(text);
    if (this.busy) return this.send('info', { text: 'Sto già lavorando: premi Interrompi prima di inviare altro.' });
    if (!this.agent.messages.length) { this.session.title = titleFrom(text); this.sendSessions(); }
    this.send('user', { text });
    const hooked = await runHook(this, 'onUserMessage', { text });
    let prompt = hooked.text || text;
    const relevant = matchSkills(prompt);
    if (relevant.length) {
      this.send('info', { text: `📘 Skill pertinente: ${relevant.map((s) => `**${s.name}**`).join(', ')}` });
      prompt += `\n\n[harness] Skill pertinenti a questa richiesta: ${relevant.map((s) => s.name).join(', ')}. ` +
        `Carica le istruzioni con lo strumento skill PRIMA di iniziare e poi seguile.`;
    }
    await this.runTask((signal) => this.agent.run(prompt, { signal }));
  }

  async runTask(fn) {
    this.busy = true;
    this.abort = new AbortController();
    this.send('busy', { busy: true });
    try {
      await fn(this.abort.signal);
      this.send('state', { state: 'success' });
    } catch (e) {
      if (e.name === 'AbortError' || this.abort.signal.aborted) {
        this.send('info', { text: '⏹ Interrotto.' });
        this.send('state', { state: 'idle' });
      } else {
        this.send('error', { text: e.message });
        this.send('state', { state: 'error' });
      }
    } finally {
      this.busy = false;
      this.abort = null;
      this.send('busy', { busy: false });
    }
  }

  async command(text) {
    const [head] = text.slice(1).split(/\s+/);
    const cmd = head.toLowerCase();
    let arg = text.slice(head.length + 1).trim();
    const info = (t) => this.send('info', { text: t });
    const takeMax = (def) => {
      const m = arg.match(/--max\s+(\d+)/);
      arg = arg.replace(/--max\s+\d+/, '').trim();
      return m ? Math.max(1, Math.min(100, Number(m[1]))) : def;
    };

    switch (cmd) {
      case 'help':
        return info(`**Comandi**\n${COMMANDS.map(([c, d]) => `- \`${c}\` — ${d}`).join('\n')}`);

      case 'goal': {
        if (!arg || arg === 'status') {
          const g = this.goal.state || this.goal.loadSaved();
          if (!g) return info('Nessun goal. Esempio: `/goal crea un sito portfolio in workspace/portfolio con test che passano --max 8`');
          return info(`**Goal:** ${g.objective}\nStato: **${g.status}** — iterazione ${g.iteration}/${g.max}\n` +
            `Score: ${g.history?.map((h) => h.score).join(' → ') || '—'}`);
        }
        if (arg === 'stop') return this.stop();
        if (this.busy) return info('Sto già lavorando: /stop prima di avviare un goal.');
        if (arg.startsWith('resume')) {
          arg = arg.slice(6);
          const max = takeMax(5);
          const saved = this.goal.state || this.goal.loadSaved();
          if (!saved) return info('Nessun goal da riprendere.');
          if (saved.status === 'achieved') return info('L\'ultimo goal è già stato raggiunto.');
          this.send('user', { text });
          return this.runTask((signal) => this.goal.run(saved.objective, { max, signal, resume: saved }));
        }
        const max = takeMax(10);
        if (!arg) return info('Specifica un obiettivo.');
        this.send('user', { text });
        return this.runTask((signal) => this.goal.run(arg, { max, signal }));
      }

      case 'stop':
        if (!this.busy) return info('Niente da interrompere.');
        return this.stop();

      case 'clear':
        this.newChat();
        return;

      case 'mode':
        if (!['ask', 'auto', 'readonly'].includes(arg)) return info('Uso: `/mode ask|auto|readonly`');
        this.cfg.mode = arg;
        this.send('config', { config: this.publicConfig() });
        return info(`Modalità permessi: **${arg}**${arg === 'auto' ? ' — i comandi pericolosi chiedono comunque conferma.' : ''}`);

      case 'brain': {
        const list = loadBrains().list;
        if (!arg) {
          return info(list.length
            ? `**Cervelli salvati**\n${list.map((b) => `- ${b.id === this.cfg.brain?.id ? '🟢' : '⚪'} **${b.name}** — \`${b.model}\` (${b.baseUrl})`).join('\n')}\n\nUsa \`/brain <nome>\` o il pulsante 🧠 in alto.`
            : 'Nessun cervello salvato: apri il pannello 🧠 in alto per aggiungerne uno.');
        }
        const b = list.find((x) => x.name.toLowerCase() === arg.toLowerCase()) || list.find((x) => x.name.toLowerCase().includes(arg.toLowerCase()) || x.model.toLowerCase().includes(arg.toLowerCase()));
        if (!b) return info(`Nessun cervello corrisponde a "${arg}".`);
        return this.activateBrain(b.id);
      }

      case 'provider':
        if (!PRESETS[arg]) return info(`Provider disponibili: ${Object.keys(PRESETS).join(', ')}`);
        this.cfg.brain = null;
        this.cfg.provider = arg;
        this.cfg.model = PRESETS[arg].model;
        this.cfg.baseUrl = null;
        this.send('config', { config: this.publicConfig() });
        return info(`Provider **${arg}**, modello \`${this.cfg.model}\`${this.providerInfo().apiKey ? '' : ` — ⚠️ manca ${PRESETS[arg].keyEnv} nel .env`}`);

      case 'model':
        if (!arg) return info(`Modello attuale: \`${this.providerInfo().model}\``);
        if (this.cfg.brain) {
          this.saveBrain({ ...this.cfg.brain, apiKey: MASK, model: arg });
          return info(`Modello del cervello **${this.cfg.brain.name}**: \`${arg}\``);
        }
        this.cfg.model = arg;
        this.send('config', { config: this.publicConfig() });
        return info(`Modello: \`${arg}\``);

      case 'cwd': {
        const dir = resolveUserPath(this.cfg.workspace, arg || '.');
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return info(`Cartella inesistente: ${dir}`);
        this.cfg.workspace = dir;
        this.send('config', { config: this.publicConfig() });
        return info(`Workspace: \`${dir}\``);
      }

      case 'tools':
        return info(`**${this.allTools().length} strumenti**\n${this.allTools().map((t) => `- \`${t.name}\` — ${t.description.split('. ')[0]}`).join('\n')}`);

      case 'soul':
        return info(`**Identità di Howl** — modifica questo file per cambiarne il carattere:\n\`${SOUL_FILE}\``);

      case 'skills': {
        const s = listSkills();
        return info(s.length
          ? `**${s.length} skill disponibili** (cartella \`${SKILLS_DIR}\`)\n${s.map((x) => `- **${x.name}** — ${x.description}`).join('\n')}`
          : `Nessuna skill. Crea una cartella con dentro un file SKILL.md in:\n\`${SKILLS_DIR}\``);
      }

      case 'hooks':
        if (arg === 'reload') {
          this.hooks = await loadHooks(this);
          return info(`Hook ricaricati: ${this.hooks.length}`);
        }
        return info(this.hooks?.length
          ? `**Hook attivi** (cartella \`${HOOKS_DIR}\`)\n${this.hooks.map((h) => `- \`${h.name}\` → ${Object.keys(h).filter((k) => k !== 'name').join(', ') || 'nessun punto di aggancio'}`).join('\n')}\n\nUsa \`/hooks reload\` dopo averli modificati.`
          : `Nessun hook. Aggiungi un file .mjs in:\n\`${HOOKS_DIR}\``);

      case 'task': case 'tasks': case 'automazioni': {
        const sc = this.scheduler;
        if (!sc) return info('Pianificatore non ancora pronto.');
        const when = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
        const [sub, ...rest] = arg.split(/\s+/);
        const restArg = rest.join(' ').trim();

        if (!arg || sub === 'list') {
          const list = sc.publicTasks();
          if (!list.length) return info('Nessuna automazione.\n\nEsempio: `/task add ogni giorno alle 8 :: cerca le novità sull\'AI e scrivimi un riassunto con le fonti`');
          return info(`**Automazioni** (${list.length})\n` + list.map((t) =>
            `- ${t.enabled ? '🟢' : '⚪'} **${t.name}** \`${t.id}\` — ${t.when}`
            + `${t.nextRun ? ` · prossima ${when(t.nextRun)}` : ''}`
            + `${t.lastRun ? ` · ultima ${t.lastStatus === 'ok' ? '✅' : '⚠️'} ${when(t.lastRun)}` : ''}`).join('\n'));
        }

        if (sub === 'add' || sub === 'new') {
          const [whenPart, ...taskParts] = restArg.split('::');
          const prompt = taskParts.join('::').trim();
          if (!prompt) return info('Uso: `/task add <quando> :: <cosa fare>`\nEsempio: `/task add ogni lunedì alle 9 :: prepara il riepilogo della settimana`');
          if (!parseWhen(whenPart)) return info(`Non ho capito "${whenPart.trim()}". Esempi: \`ogni giorno alle 8:00\`, \`ogni lunedì e giovedì alle 9:30\`, \`ogni 30 minuti\`, \`domani alle 18\`.`);
          const t = sc.create({ when: whenPart, prompt, name: prompt.slice(0, 50) });
          return info(`🕗 Automazione **${t.name}** creata — ${describeSchedule(t.schedule)}.\nPrima esecuzione: ${when(t.nextRun)}. Id \`${t.id}\`.`);
        }

        const t = sc.find(restArg);
        if (!t) return info(`Automazione "${restArg}" non trovata. Vedi \`/task\`.`);
        if (sub === 'del' || sub === 'rm' || sub === 'delete') { sc.remove(t.id); return info(`Automazione **${t.name}** eliminata.`); }
        if (sub === 'on' || sub === 'enable') { sc.update(t.id, { enabled: true }); return info(`**${t.name}** riattivata — prossima ${when(t.nextRun)}.`); }
        if (sub === 'off' || sub === 'disable' || sub === 'pause') { sc.update(t.id, { enabled: false }); return info(`**${t.name}** in pausa.`); }
        if (sub === 'log' || sub === 'storico') {
          const runs = (t.runs || []).slice(-8).reverse();
          return info(`**${t.name}** — ${describeSchedule(t.schedule)}\n\n> ${t.prompt}\n\n` + (runs.length
            ? `**Ultime esecuzioni**\n${runs.map((r) => `- ${r.ok ? '✅' : '⚠️'} ${when(r.at)} (${Math.round(r.ms / 1000)}s) — ${(r.report || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')}`
            : 'Mai eseguita.'));
        }
        if (sub === 'run' || sub === 'esegui') {
          if (this.busy) return info('Sto già lavorando: /stop prima di lanciare un\'automazione.');
          info(`🕗 Eseguo **${t.name}** adesso…`);
          sc.execute(t, 'manual').catch((e) => this.send('error', { text: e.message }));
          return;
        }
        return info('Uso: `/task`, `/task add <quando> :: <cosa>`, `/task run|on|off|del|log <id>`');
      }

      case 'memory': {
        const m = fs.existsSync(MEMORY_FILE) ? fs.readFileSync(MEMORY_FILE, 'utf8') : '';
        return info(m ? `**Memoria**\n${m}` : 'Memoria vuota.');
      }

      case 'compact':
        if (this.busy) return info('Occupato.');
        return this.runTask((signal) => this.agent.compact(signal, true));

      default:
        return info(`Comando sconosciuto: /${cmd}. Scrivi /help.`);
    }
  }
}
