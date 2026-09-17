// /goal — loop engineering.
// 1) PIANIFICA: l'obiettivo diventa criteri di successo verificabili + piano.
// 2) ESEGUI: l'agente principale lavora in autonomia.
// 3) VERIFICA: un agente separato e scettico controlla le prove e dà un punteggio.
// 4) RIPETI con il feedback del verificatore finché: raggiunto | limite iterazioni | stallo | stop.
import fs from 'node:fs';
import path from 'node:path';
import { Agent } from './agent.js';
import { chat } from './providers.js';
import { DATA_DIR } from './config.js';
import { buildSystemPrompt } from './prompt.js';

const GOAL_FILE = path.join(DATA_DIR, 'goal.json');
const VERIFIER_TOOLS = new Set(['read_file', 'list_dir', 'glob', 'grep', 'web_fetch', 'web_search', 'run_command', 'process_output', 'browser', 'computer']);

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export class GoalRunner {
  constructor(h) {
    this.h = h;
    this.state = null;
  }

  loadSaved() {
    try { return JSON.parse(fs.readFileSync(GOAL_FILE, 'utf8')); } catch { return null; }
  }

  save() {
    fs.writeFileSync(GOAL_FILE, JSON.stringify(this.state, null, 2));
    this.h.send('goal', { goal: this.state });
  }

  phase(status, text) {
    this.state.status = status;
    this.save();
    this.h.send('goal_phase', { phase: status, iteration: this.state.iteration, max: this.state.max, text });
  }

  async run(objective, { max = 10, signal, resume = null }) {
    try {
      if (resume) {
        this.state = { ...resume, max: resume.iteration + max };
        this.phase('working', `Riprendo l'obiettivo (fino a ${max} iterazioni in più)`);
      } else {
        this.state = { objective, max, iteration: 0, status: 'planning', criteria: [], history: [], startedAt: Date.now() };
        this.phase('planning', 'Trasformo l\'obiettivo in criteri di successo verificabili…');
        const plan = await this.plan(objective, signal);
        this.state.criteria = plan.criteria;
        this.save();
        if (plan.steps.length) this.h.setTodos(plan.steps.map((text) => ({ text, status: 'pending' })));
        this.h.send('info', { text: `**Criteri di successo:**\n${plan.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` });
      }

      for (;;) {
        if (signal?.aborted) throw Object.assign(new Error('Interrotto'), { name: 'AbortError' });
        const s = this.state;
        s.iteration++;
        this.phase('working', `Iterazione ${s.iteration}/${s.max}: l'esecutore lavora verso l'obiettivo`);
        const report = await this.h.agent.run(this.workPrompt(), { signal });
        s.lastReport = (report || '').slice(0, 6000);

        this.phase('verifying', `Iterazione ${s.iteration}: un verificatore indipendente controlla le prove`);
        const v = await this.verify(s.lastReport, signal);
        s.history.push({ iteration: s.iteration, score: v.score, done: v.done, feedback: v.feedback, missing: v.missing, at: Date.now() });
        s.lastVerdict = v;
        this.save();
        this.h.send('goal_verdict', { iteration: s.iteration, ...v });

        if (v.done) { this.phase('achieved', `🎯 Obiettivo raggiunto in ${s.iteration} iterazion${s.iteration === 1 ? 'e' : 'i'}`); return; }
        if (s.iteration >= s.max) { this.phase('exhausted', `Limite di ${s.max} iterazioni raggiunto (score ${v.score}). Usa /goal resume per continuare.`); return; }
        if (this.stalled()) { this.phase('stalled', 'Nessun miglioramento nelle ultime 3 iterazioni: mi fermo. Rivedi l\'obiettivo o dai indicazioni, poi /goal resume.'); return; }
      }
    } catch (e) {
      if (this.state) this.phase(e.name === 'AbortError' ? 'stopped' : 'failed', e.name === 'AbortError' ? 'Goal interrotto. /goal resume per riprendere.' : `Goal fallito: ${e.message}`);
      throw e;
    }
  }

  async plan(objective, signal) {
    const resp = await chat(this.h.providerInfo(), {
      system: 'Sei un pianificatore rigoroso di agenti AI. Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo.',
      messages: [{
        role: 'user',
        content: `Obiettivo dell'utente: ${objective}\n\nWorkspace: ${this.h.cfg.workspace}\nSistema: ${process.platform}\n\n` +
          'Produci {"criteria": [...], "steps": [...]} dove:\n' +
          '- criteria: da 3 a 7 criteri di successo CONCRETI e VERIFICABILI con prove oggettive (file esistenti con certi contenuti, comandi/test che passano, output attesi, informazioni trovate con fonte).\n' +
          '- steps: da 4 a 10 passi di un piano d\'azione.\nScrivi nella lingua dell\'obiettivo.',
      }],
      signal,
      maxTokens: 2500,
    });
    this.h.addUsage(resp.usage);
    const j = extractJson(resp.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    return {
      criteria: Array.isArray(j?.criteria) && j.criteria.length ? j.criteria.map(String) : [objective],
      steps: Array.isArray(j?.steps) ? j.steps.map(String) : [],
    };
  }

  workPrompt() {
    const s = this.state;
    const v = s.lastVerdict;
    let p = `[GOAL LOOP — iterazione ${s.iteration}/${s.max}]\n\nOBIETTIVO: ${s.objective}\n\nCRITERI DI SUCCESSO:\n${s.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;
    if (v) {
      p += `\nESITO DELLA VERIFICA PRECEDENTE — score ${v.score}/100, NON ancora raggiunto.\n`;
      if (v.criteria?.length) p += v.criteria.map((c) => `- [${c.met ? 'OK' : 'NO'}] ${c.criterion}${c.evidence ? ` — ${c.evidence}` : ''}`).join('\n') + '\n';
      if (v.missing?.length) p += `Mancante:\n${v.missing.map((m) => `- ${m}`).join('\n')}\n`;
      p += `Feedback del verificatore: ${v.feedback}\n`;
    }
    p += '\nLavora in AUTONOMIA verso l\'obiettivo: non fare domande all\'utente, prendi decisioni ragionevoli e annotale. ' +
      'Aggiorna il piano con todo_write. Verifica tu stesso ogni criterio (esegui, testa, controlla). ' +
      'Quando pensi che TUTTI i criteri siano soddisfatti, termina con un REPORT che per ogni criterio indica la prova concreta (percorso file, comando e output, URL).';
    return p;
  }

  async verify(report, signal) {
    let verdict = null;
    const submit = {
      name: 'submit_verdict',
      description: 'Registra il verdetto finale della verifica. Chiamalo una sola volta, alla fine.',
      input_schema: {
        type: 'object',
        properties: {
          done: { type: 'boolean', description: 'true SOLO se tutti i criteri sono soddisfatti con prove verificate' },
          score: { type: 'integer', description: '0-100, avanzamento complessivo' },
          criteria: {
            type: 'array',
            items: { type: 'object', properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['criterion', 'met'] },
          },
          missing: { type: 'array', items: { type: 'string' } },
          feedback: { type: 'string', description: 'istruzioni concrete e azionabili per la prossima iterazione' },
        },
        required: ['done', 'score', 'feedback'],
      },
      risk: 'read',
      async run(input, ctx) {
        verdict = input;
        ctx.agent.finishRequested = true;
        return 'Verdetto registrato.';
      },
    };
    const s = this.state;
    const verifier = new Agent({
      harness: this.h,
      name: 'verifier',
      tools: [...this.h.allTools().filter((t) => VERIFIER_TOOLS.has(t.name)), submit],
      maxSteps: 30,
      systemPrompt: buildSystemPrompt(this.h,
        '\n# RUOLO: VERIFICATORE INDIPENDENTE\nSei un revisore scettico. Devi stabilire se l\'obiettivo è DAVVERO raggiunto. ' +
        'Non fidarti del report dell\'esecutore: controlla direttamente le prove (leggi file, esegui test o comandi NON distruttivi, apri pagine). ' +
        'NON modificare nulla. done=true solo se ogni criterio è soddisfatto con evidenza verificata da te. ' +
        'Il feedback deve dire esattamente cosa manca e come correggerlo. Alla fine chiama submit_verdict.'),
    });
    const out = await verifier.run(
      `OBIETTIVO: ${s.objective}\n\nCRITERI:\n${s.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n` +
      `REPORT DELL'ESECUTORE (iterazione ${s.iteration}):\n${report || '(nessun report)'}\n\nVerifica e poi chiama submit_verdict.`,
      { signal },
    );
    if (!verdict) {
      verdict = { done: false, score: s.history.at(-1)?.score ?? 0, missing: [], feedback: `Il verificatore non ha emesso un verdetto strutturato. Note: ${(out || '').slice(0, 800)}` };
    }
    verdict.score = Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0)));
    verdict.missing ||= [];
    verdict.done = !!verdict.done;
    return verdict;
  }

  stalled() {
    const sc = this.state.history.map((x) => x.score);
    if (sc.length < 4) return false;
    const best = Math.max(...sc.slice(0, -3));
    return sc.slice(-3).every((x) => x <= best);
  }
}
