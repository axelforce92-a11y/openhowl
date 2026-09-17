// L'agent loop: modello → strumenti → risultati → modello … finché il modello non ha più nulla da fare.
import { chat } from './providers.js';
import { runHook } from './hooks.js';

let segCounter = 0;
const KEEP_IMAGES = 3;
const abortError = () => Object.assign(new Error('Interrotto'), { name: 'AbortError' });

function normalizeOutput(out) {
  if (out == null) return { text: '', images: [] };
  if (typeof out === 'string') return { text: out, images: [] };
  return { text: out.text || '', images: out.images || [] };
}
// Frasi con cui il modello dichiara di aver compiuto un'azione concreta.
const CLAIM = /\b(ho (creato|scritto|salvato|eseguito|spostato|copiato|eliminato|cancellato|rinominato|installato|aperto|modificato|aggiornato|inviato|scaricato)|(cartella|file|documento) (è stat[oa] )?(creat[oa]|salvat[oa])|(creat[oa]|salvat[oa]) (con successo|correttamente)|i('|’)ve (created|written|saved|run|moved|deleted))\b/i;
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… [troncato, ${s.length} caratteri]` : s);

export class Agent {
  constructor({ harness, name = 'main', tools, systemPrompt, maxSteps = 80 }) {
    this.h = harness;
    this.name = name;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxSteps = maxSteps;
    this.messages = [];
    this.finishRequested = false;
  }

  emit(type, data = {}) { this.h.send(type, { agent: this.name, ...data }); }

  async run(input, { signal } = {}) {
    // Se l'ultimo messaggio è già dell'utente (es. dopo un'interruzione) accodiamo, per mantenere l'alternanza dei ruoli.
    const last = this.messages.at(-1);
    if (last?.role === 'user') {
      const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
      last.content = [...blocks, { type: 'text', text: input }];
    } else {
      this.messages.push({ role: 'user', content: input });
    }
    this.finishRequested = false;
    const toolMap = new Map(this.tools.map((t) => [t.name, t]));
    const schemas = this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    let finalText = '';
    let nudged = false;
    let toolsUsed = false;
    let claimChecked = false;

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) throw abortError();
      this.pruneImages();
      await this.maybeCompact(signal);

      this.emit('state', { state: 'thinking' });
      const seg = ++segCounter;
      let streaming = false;
      const system = typeof this.systemPrompt === 'function' ? this.systemPrompt() : this.systemPrompt;
      const resp = await chat(this.h.providerInfo(), {
        system,
        messages: this.messages,
        tools: schemas,
        signal,
        maxTokens: this.h.limits.maxTokens,
        thinkingBudget: this.h.limits.thinkingBudget,
        onDelta: (d) => {
          if (d.type === 'text') {
            if (!streaming) { streaming = true; this.emit('state', { state: 'streaming' }); }
            this.emit('text_delta', { seg: `s${seg}`, text: d.text });
          } else {
            this.emit('thinking_delta', { seg: `t${seg}`, text: d.text });
          }
        },
      });
      this.h.addUsage(resp.usage);
      // quanto della finestra di contesto è occupato adesso (input della richiesta + risposta)
      if (this.name === 'main') this.h.setContext((resp.usage.input || 0) + (resp.usage.output || 0));
      this.messages.push({ role: 'assistant', content: resp.content });

      const thinking = resp.content.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('\n').trim();
      if (thinking) this.emit('thinking', { seg: `t${seg}`, text: thinking });
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) { this.emit('assistant_text', { seg: `s${seg}`, text }); finalText = text; }

      const uses = resp.content.filter((b) => b.type === 'tool_use');
      if (uses.some((u) => u.name !== 'todo_write')) toolsUsed = true;
      if (!uses.length) {
        if (resp.stop_reason === 'max_tokens') {
          this.messages.push({ role: 'user', content: 'Risposta troncata per limite di token: continua esattamente da dove eri rimasto.' });
          continue;
        }
        // Modelli piccoli a volte chiudono il turno con solo ragionamento e nessuna risposta: chiediamo di rispondere (una volta).
        if (!text && !nudged && this.name !== 'verifier') {
          nudged = true;
          if (!resp.content.length) this.messages.pop();
          this.messages.push({ role: 'user', content: '[harness] Non hai scritto nessuna risposta. Scrivi ora all\'utente il risultato di quello che hai fatto.' });
          continue;
        }
        // Anti-allucinazione: dichiara di aver agito senza aver usato nessuno strumento in questo turno.
        if (text && !toolsUsed && !claimChecked && CLAIM.test(text)) {
          claimChecked = true;
          this.emit('info', { text: '🐾 Verifica: Howl ha detto di aver fatto un\'azione senza usare strumenti. Gli chiedo di farla davvero.' });
          this.messages.push({ role: 'user', content: '[harness] Hai scritto di aver svolto un\'azione, ma in questo turno NON hai chiamato nessuno strumento: in realtà non è stato fatto nulla. Esegui ora l\'azione con gli strumenti appropriati e poi riporta il risultato reale, oppure correggi la risposta.' });
          continue;
        }
        return finalText;
      }

      // Strumenti "sola lettura" consecutivi vengono eseguiti in parallelo; il resto in sequenza.
      const results = new Array(uses.length);
      try {
        let i = 0;
        while (i < uses.length) {
          if (signal?.aborted) throw abortError();
          const isRead = (tu) => { const t = toolMap.get(tu.name); return t && (typeof t.risk === 'function' ? t.risk(tu.input || {}) : t.risk) === 'read' && tu.name !== 'delegate'; };
          if (isRead(uses[i])) {
            let j = i;
            while (j < uses.length && isRead(uses[j])) j++;
            const batch = await Promise.all(uses.slice(i, j).map((tu) => this.execTool(tu, toolMap, signal)));
            batch.forEach((r, k) => (results[i + k] = r));
            i = j;
          } else {
            results[i] = await this.execTool(uses[i], toolMap, signal);
            i++;
          }
        }
      } finally {
        // Ogni tool_use deve avere il suo tool_result, anche se interrotto.
        uses.forEach((tu, k) => { results[k] ??= { type: 'tool_result', tool_use_id: tu.id, content: 'Annullato dall\'utente.', is_error: true }; });
        this.messages.push({ role: 'user', content: results });
      }
      if (this.finishRequested) return finalText;
    }
    this.emit('info', { text: `Limite di ${this.maxSteps} passi raggiunto per questo turno.` });
    return finalText;
  }

  async execTool(tu, toolMap, signal) {
    const t0 = Date.now();
    const id = tu.id;
    const input = tu.input || {};
    this.emit('tool_start', { id, name: tu.name, input });
    const fail = (msg) => {
      this.emit('tool_end', { id, ok: false, output: msg, ms: Date.now() - t0 });
      return { type: 'tool_result', tool_use_id: id, content: msg, is_error: true };
    };
    const tool = toolMap.get(tu.name);
    if (!tool) return fail(`Strumento sconosciuto: ${tu.name}`);
    const risk = typeof tool.risk === 'function' ? tool.risk(input) : tool.risk;

    // hooks: possono bloccare, modificare i parametri o approvare automaticamente
    const pre = await runHook(this.h, 'beforeTool', { name: tu.name, input });
    if (pre.deny) {
      this.emit('info', { text: `⛔ Azione bloccata dall'hook \`${pre.hook}\`: ${pre.deny}` });
      return fail(`Azione bloccata da un hook dell'utente: ${pre.deny}. Non insistere: proponi un'alternativa.`);
    }
    Object.assign(input, pre.input || {});

    const allowed = pre.approve || await this.h.approve({ name: tu.name, input, risk, agent: this.name });
    if (signal?.aborted) throw abortError();
    if (!allowed) return fail('L\'utente ha NEGATO il permesso per questa azione. Non riprovarla identica: proponi un\'alternativa o chiedi chiarimenti.');

    this.emit('state', { state: 'tool', tool: tu.name });
    try {
      const out = normalizeOutput(await tool.run(input, { h: this.h, agent: this, signal, workspace: this.h.cfg.workspace }));
      const post = await runHook(this.h, 'afterTool', { name: tu.name, input, output: out.text });
      if (typeof post.output === 'string') out.text = post.output;
      const text = clip(out.text, 50000);
      const content = [
        ...(text ? [{ type: 'text', text }] : []),
        ...out.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
      ];
      this.emit('tool_end', {
        id, ok: true, ms: Date.now() - t0,
        output: clip(out.text, 6000),
        images: out.images.map((im) => `data:${im.media_type};base64,${im.data}`),
      });
      return { type: 'tool_result', tool_use_id: id, content: content.length ? content : '(nessun output)' };
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw abortError();
      return fail(`Errore: ${e.message}`);
    }
  }

  // Mantiene solo gli ultimi screenshot: le immagini vecchie costano molti token e servono poco.
  pruneImages() {
    let seen = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (typeof m.content === 'string') continue;
      for (const b of m.content) {
        if (b.type !== 'tool_result' || !Array.isArray(b.content)) continue;
        b.content = b.content.map((c) => {
          if (c.type !== 'image') return c;
          return ++seen > KEEP_IMAGES ? { type: 'text', text: '[immagine precedente rimossa dal contesto]' } : c;
        });
      }
    }
  }

  estimateTokens() {
    let chars = 0;
    for (const m of this.messages) {
      if (typeof m.content === 'string') { chars += m.content.length; continue; }
      for (const b of m.content) {
        if (b.type === 'tool_result' && Array.isArray(b.content)) b.content.forEach((c) => (chars += c.type === 'image' ? 6000 : (c.text || '').length));
        else if (b.type === 'image') chars += 6000;
        else chars += JSON.stringify(b).length;
      }
    }
    return Math.round(chars / 3.5);
  }

  async maybeCompact(signal) {
    if (this.estimateTokens() > this.h.limits.contextLimit * 0.75) await this.compact(signal);
  }

  // Compattazione: riassume la parte vecchia della conversazione e tiene la coda recente intatta.
  async compact(signal, force = false) {
    if (this.messages.length < 6) { if (force) this.emit('info', { text: 'Conversazione troppo corta da compattare.' }); return; }
    let cut = -1;
    for (let i = this.messages.length - 5; i >= 2; i--) if (this.messages[i].role === 'assistant') { cut = i; break; }
    if (cut < 0) return;
    this.emit('state', { state: 'thinking' });
    this.emit('info', { text: '🗜️ Compatto il contesto…' });
    const serialize = (m) => {
      if (typeof m.content === 'string') return `${m.role.toUpperCase()}: ${m.content}`;
      return m.content.map((b) => {
        if (b.type === 'text') return `${m.role.toUpperCase()}: ${b.text}`;
        if (b.type === 'tool_use') return `TOOL CALL ${b.name}: ${JSON.stringify(b.input).slice(0, 800)}`;
        if (b.type === 'tool_result') {
          const t = typeof b.content === 'string' ? b.content : (b.content || []).map((c) => c.text || '[img]').join('\n');
          return `TOOL RESULT${b.is_error ? ' (errore)' : ''}: ${t.slice(0, 1500)}`;
        }
        return '';
      }).filter(Boolean).join('\n');
    };
    const transcript = this.messages.slice(0, cut).map(serialize).join('\n\n').slice(-400000);
    const resp = await chat(this.h.providerInfo(), {
      system: 'Riassumi conversazioni di un agente AI in modo che possa continuare il lavoro senza perdere nulla di importante.',
      messages: [{ role: 'user', content: `Riassumi questa conversazione: richieste dell'utente, obiettivi, decisioni, file creati/modificati (percorsi), comandi rilevanti e risultati, problemi aperti, prossimi passi. Sii denso e preciso.\n\n${transcript}` }],
      signal,
      maxTokens: 4000,
    });
    this.h.addUsage(resp.usage);
    const summary = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    this.messages = [{ role: 'user', content: `[RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE — il contesto è stato compattato]\n${summary}` }, ...this.messages.slice(cut)];
    this.emit('info', { text: `Contesto compattato (~${this.estimateTokens()} token stimati).` });
  }
}
