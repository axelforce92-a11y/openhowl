// Laboratorio del branco: avvia, ferma e conserva le corse di addestramento degli agenti (in locale).
// Ogni corsa gira in un processo separato (branco-agenti.mjs) e scrive in ~/.openhowl/branco/<id>/risultati.json.
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../config.js';
import { loadMondo, saveMondo, generateExam, listFondatori, saveFondatore, deleteFondatore, testFondatore } from './agenti-custom.js';

// Nell'app installata i file stanno in app.asar: lo script va eseguito dalla copia "unpacked".
const HERE = path.dirname(fileURLToPath(import.meta.url)).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const SCRIPT = path.join(HERE, 'branco-agenti.mjs');
export const BRANCO_DIR = path.join(DATA_DIR, 'branco');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export class BrancoManager {
  constructor(h) {
    this.h = h;
    this.child = null;
    this.runId = null;
    this.log = [];
  }

  get running() { return !!this.child; }

  mondoGet() { return { mondo: loadMondo() }; }
  mondoSave(body) { return { mondo: saveMondo(body) }; }
  async mondoGenera(body, providerInfo) { return await generateExam(body, providerInfo); }
  fondatoriList() { return { fondatori: listFondatori() }; }
  fondatoriSave(body) { return { fondatori: saveFondatore(body) }; }
  fondatoriDelete(body) { return { fondatori: deleteFondatore(body.id) }; }
  async fondatoriTest(body, providerInfo) { return await testFondatore(body.fondatore, body.domanda, body.mondo, providerInfo); }


  list() {
    fs.mkdirSync(BRANCO_DIR, { recursive: true });
    return fs.readdirSync(BRANCO_DIR).map((id) => {
      const d = readJson(path.join(BRANCO_DIR, id, 'risultati.json'));
      if (!d) return null;
      const done = d.nodi.filter((n) => n.voto != null);
      const alpha = d.alfa != null ? d.nodi[d.alfa] : null;
      const N = d.esame?.length || 1;
      return {
        id, creato: d.creato, modello: d.modello, obiettivo: d.config?.obiettivo, generazioni: d.config?.generations,
        stato: id === this.runId ? 'in corso' : d.stato === 'finito' ? 'finita' : 'interrotta',
        esaminati: done.length, previsti: 6 + (d.config?.generations || 0) * (d.config?.kidsPerGen || 0),
        alfa: alpha ? { nome: alpha.nome, voto: `${Math.round(alpha.voto * N)}/${N}`, secondi: Math.round(alpha.secondi), segreto: alpha.votoSegreto != null ? `${Math.round(alpha.votoSegreto * (d.segreto?.length || 1))}/${d.segreto?.length}` : null } : null,
      };
    }).filter(Boolean).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }

  data(id) {
    const safe = String(id || '').replace(/[^\w-]/g, '');
    const d = readJson(path.join(BRANCO_DIR, safe, 'risultati.json'));
    if (!d) throw new Error('Corsa non trovata.');
    return d;
  }

  start({ obiettivo = 'equilibrio', generazioni = 4, figli = 6, riprendi = true, famiglie = 1, migrazione = 2, crossbreed = false } = {}) {
    if (this.child) throw new Error('C\'è già una corsa in corso: fermala prima.');
    if (this.h.busy || this.h.remoteBusy) throw new Error('Howl sta lavorando: il branco userebbe lo stesso modello e falserebbe i tempi. Riprova quando ha finito.');
    const p = this.h.providerInfo();
    if (p.kind === 'anthropic') throw new Error('Il laboratorio funziona con modelli compatibili OpenAI (LM Studio, Ollama…). Attiva un modello locale.');
    if (!/127\.0\.0\.1|localhost/.test(p.baseUrl)) throw new Error('Per sicurezza e costi il laboratorio usa solo modelli LOCALI (LM Studio, Ollama). Attiva un modello locale dal pannello Modello.');
    const id = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
    const out = path.join(BRANCO_DIR, id);
    fs.mkdirSync(out, { recursive: true });
    const args = ['--url', p.baseUrl, '--modello', p.model, '--obiettivo', obiettivo === 'intelligenza' ? 'intelligenza' : 'equilibrio',
      '--gen', String(Math.min(10, Math.max(1, Number(generazioni) || 4))), '--figli', String(Math.min(10, Math.max(2, Number(figli) || 6))), '--out', out];
    // riusa i fondatori dell'ultima corsa con lo stesso modello: fa risparmiare ~10 minuti
    
    args.push('--famiglie', String(famiglie));
    args.push('--migrazione', String(migrazione));
    if (crossbreed) args.push('--crossbreed');
    
    const m = loadMondo();
    if (m) args.push('--mondo', path.join(BRANCO_DIR, 'mondo.json'));
    const f = listFondatori();
    if (f && f.length) args.push('--fondatori-file', path.join(BRANCO_DIR, 'fondatori.json'));

    if (riprendi) {
      const prev = this.list().find((r) => r.modello === p.model && r.esaminati >= 6);
      if (prev) args.push('--riprendi', path.join(BRANCO_DIR, prev.id, 'risultati.json'));
    }
    this.log = [];
    this.child = fork(SCRIPT, args, { cwd: out, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.runId = id;
    const onLine = (buf) => {
      for (const line of String(buf).split(/\r?\n/).filter(Boolean)) {
        this.log.push(line);
        if (this.log.length > 400) this.log.shift();
        try { fs.appendFileSync(path.join(out, 'corsa.log'), `${line}\n`); } catch {}
        if (/→|— Generazione|nuova regola|ALFA|Fatto|Esame segreto/.test(line)) this.h.broadcast('branco', { id, line });
      }
    };
    this.child.stdout.on('data', onLine);
    this.child.stderr.on('data', onLine);
    this.child.on('exit', (code) => {
      this.h.broadcast('branco', { id, fine: true, code });
      this.child = null;
      this.runId = null;
    });
    return { id };
  }

  stop() {
    if (!this.child) return false;
    this.child.kill();
    return true;
  }
}
