// Motore locale: controlla LM Studio (carica, scarica, misura, ottimizza) tramite la sua API REST /api/v1.
// Regola d'oro su una sola GPU: UN modello alla volta, configurato per stare tutto in VRAM.
// Misure su RX 5700 XT (Vulkan, Qwen3.5 9B Q4_K_M): parallel 1 = +20% tok/s, batch 2048 = prompt letto 2× più veloce,
// contesto oltre la VRAM libera = crollo a pochi tok/s. Per questo l'ottimizzazione misura invece di indovinare.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR } from './config.js';

export const LMS_API = 'http://127.0.0.1:1234';
export const LMS_BASE_URL = `${LMS_API}/v1`;
export const isLmStudioUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost):1234(\/|$)/.test(String(u || ''));
const PROFILES_FILE = path.join(DATA_DIR, 'engine.json');

// Configurazione di partenza sicura quando un modello non è ancora stato ottimizzato.
export const SAFE_CONFIG = { context_length: 16384, flash_attention: false, parallel: 1, eval_batch_size: 2048, physical_batch_size: 2048, offload_kv_cache_to_gpu: true };

const loadProfiles = () => { try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch { return {}; } };
const saveProfiles = (p) => fs.writeFileSync(PROFILES_FILE, JSON.stringify(p, null, 2));
export const getProfile = (model) => loadProfiles()[model] || null;
function setProfile(model, patch) {
  const all = loadProfiles();
  all[model] = { ...all[model], ...patch, updatedAt: Date.now() };
  saveProfiles(all);
  return all[model];
}

async function api(pathname, body, timeoutMs = 8000) {
  let res;
  try {
    res = await fetch(`${LMS_API}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? 'LM Studio non risponde in tempo.' : 'LM Studio non è raggiungibile: aprilo e avvia il server (scheda Developer → Start server).');
    err.offline = e.name !== 'TimeoutError';
    throw err;
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`LM Studio: ${j.error?.message || j.error || `HTTP ${res.status}`}`);
  return j;
}

/* ── VRAM (Windows): uso dai contatori di prestazione, totale dal registro del driver ── */
let vramCache = { at: 0, value: null, pending: null };
const VRAM_PS = `$u=(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object CookedValue -Maximum;` +
  `$k=Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | Select-Object -First 1;` +
  `[pscustomobject]@{used=$u.Maximum; total=$k.'HardwareInformation.qwMemorySize'; name=$k.DriverDesc} | ConvertTo-Json -Compress`;
export function readVram({ maxAgeMs = 3000 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (Date.now() - vramCache.at < maxAgeMs) return Promise.resolve(vramCache.value);
  vramCache.pending ??= new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', VRAM_PS], { timeout: 10000, windowsHide: true }, (err, out) => {
      let v = null;
      try {
        const j = JSON.parse(String(out).trim());
        if (j.total > 0) v = { used: Number(j.used) || 0, total: Number(j.total), name: j.name || 'GPU' };
      } catch {}
      vramCache = { at: Date.now(), value: v, pending: null };
      resolve(v);
    });
  });
  return vramCache.pending;
}

/* ── Stato ── */
const isChat = (m) => m.type === 'llm' || m.type === 'vlm';
export async function engineStatus() {
  let models;
  try { models = (await api('/api/v1/models')).models || []; } catch (e) {
    return { online: false, error: e.message, vram: await readVram(), models: [] };
  }
  const profiles = loadProfiles();
  return {
    online: true,
    vram: await readVram(),
    models: models.filter(isChat).map((m) => ({
      key: m.key,
      name: m.display_name || m.key,
      params: m.params_string || null,
      arch: m.architecture || null,
      quant: m.quantization?.name || null,
      sizeBytes: m.size_bytes || 0,
      maxContext: m.max_context_length || null,
      vision: !!m.capabilities?.vision,
      tools: !!m.capabilities?.trained_for_tool_use,
      reasoning: !!m.capabilities?.reasoning,
      instances: (m.loaded_instances || []).map((i) => ({ id: i.id, config: i.config })),
      profile: profiles[m.key] || null,
    })),
  };
}

// Contesto effettivamente caricato per un modello (per non mandare mai più token di quelli che il server accetta).
export async function loadedContext(modelId) {
  try {
    const { models = [] } = await api('/api/v1/models', null, 3000);
    for (const m of models) for (const i of m.loaded_instances || []) {
      if (i.id === modelId || m.key === modelId) return i.config?.context_length || null;
    }
  } catch {}
  return null;
}

/* ── Carica / scarica ── */
export async function unloadAll() {
  const { models = [] } = await api('/api/v1/models');
  const ids = models.filter(isChat).flatMap((m) => (m.loaded_instances || []).map((i) => i.id));
  // Un'istanza può sparire da sola (crash del runtime, TTL): non è un errore, basta che la VRAM sia libera.
  for (const id of ids) await api('/api/v1/models/unload', { instance_id: id }, 60000).catch(() => {});
  return ids;
}
export const unload = (id) => api('/api/v1/models/unload', { instance_id: id }, 60000);

const LOAD_KEYS = ['context_length', 'flash_attention', 'parallel', 'eval_batch_size', 'physical_batch_size', 'offload_kv_cache_to_gpu'];
export async function loadModel(model, config = {}) {
  const cfg = { ...SAFE_CONFIG, ...(getProfile(model)?.config || {}), ...config };
  const body = { model };
  for (const k of LOAD_KEYS) if (cfg[k] !== undefined) body[k] = cfg[k];
  await unloadAll(); // mai due modelli (o due copie) a contendersi la VRAM
  const r = await api('/api/v1/models/load', body, 300000);
  return { instanceId: r.instance_id || model, config: body, loadSeconds: r.load_time_seconds || null };
}

/* ── Misura ── */
async function stream(model, messages, maxTokens, signal) {
  const t0 = performance.now();
  const res = await fetch(`${LMS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens, temperature: 0, reasoning_effort: 'none' }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000),
  });
  if (!res.ok) throw new Error(`LM Studio: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', first = 0, chunks = 0, usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      let j;
      try { j = JSON.parse(line.slice(5)); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (d && (d.content || d.reasoning_content || d.reasoning)) { chunks++; if (!first) first = performance.now(); }
      if (j.usage) usage = j.usage;
    }
  }
  const end = performance.now();
  return { ttftMs: (first || end) - t0, genMs: end - (first || end), promptTokens: usage?.prompt_tokens || 0, outTokens: usage?.completion_tokens || chunks };
}

// Testo di lettura deterministico (~2000 token): misura la velocità con cui il modello legge un prompt lungo,
// che per un agente conta quanto la generazione (strumenti + file letti finiscono tutti nel prompt).
const READ_TEXT = Array.from({ length: 70 }, (_, i) => `Voce ${i}: il lupo ${i % 7} attraversa il bosco ${(i * 13) % 97} cercando la traccia ${(i * 7) % 11}.`).join('\n');

export async function benchmark(model, { signal, save = true } = {}) {
  // Riscaldamento: il primo giro include compilazione shader e caricamento pigro.
  await stream(model, [{ role: 'user', content: 'Ciao' }], 8, signal);
  // Un nonce rende il prompt unico: niente cache del prefisso, misuriamo la lettura vera.
  const nonce = Math.random().toString(36).slice(2);
  const read = await stream(model, [{ role: 'user', content: `[${nonce}]\n${READ_TEXT}\n\nQuante voci citano il bosco 5? Rispondi con un numero.` }], 4, signal);
  const gen = await stream(model, [{ role: 'user', content: 'Scrivi una funzione JavaScript che ordina un array di oggetti per data, poi spiegala in 5 punti.' }], 256, signal);
  const result = {
    genTps: +(gen.outTokens / Math.max(gen.genMs / 1000, 0.001)).toFixed(1),
    readTps: +(read.promptTokens / Math.max(read.ttftMs / 1000, 0.001)).toFixed(0),
    ttftMs: Math.round(gen.ttftMs),
    at: Date.now(),
  };
  if (save) setProfile(model, { bench: result });
  return result;
}

/* ── Ottimizzazione automatica ── */
// Prova configurazioni reali sulla GPU di questo PC e tiene la più veloce con il contesto più grande.
// Punteggio: scrittura entro il 10% e lettura entro il 25% dalle migliori, poi il contesto più grande.
export async function autotune(model, { onProgress = () => {}, signal } = {}) {
  const status = await engineStatus();
  if (!status.online) throw new Error(status.error);
  const info = status.models.find((m) => m.key === model);
  if (!info) throw new Error(`Modello non trovato in LM Studio: ${model}`);
  const maxCtx = info.maxContext || 32768;
  const ladder = [8192, 16384, 32768, 65536].filter((c) => c <= maxCtx);
  const plan = [];
  for (const ctx of ladder) for (const fa of [false, true]) plan.push({ ...SAFE_CONFIG, context_length: ctx, flash_attention: fa });

  const trials = [];
  let bestGen = 0, stopAbove = Infinity;
  for (let n = 0; n < plan.length; n++) {
    if (signal?.aborted) throw new Error('Ottimizzazione interrotta.');
    const cfg = plan[n];
    if (cfg.context_length > stopAbove) continue;
    const label = `${cfg.context_length / 1024}k · flash attention ${cfg.flash_attention ? 'sì' : 'no'}`;
    onProgress({ phase: 'trial', index: n + 1, total: plan.length, label, trials });
    const trial = { config: cfg, label };
    try {
      await loadModel(model, cfg);
      const vram = await readVram({ maxAgeMs: 0 });
      trial.vramUsed = vram?.used || null;
      // Prova lampo: oltre la VRAM fisica il driver usa la RAM condivisa e la velocità crolla.
      // Inutile allora la misura completa (con un modello che sfora dura minuti): la scartiamo subito.
      await stream(model, [{ role: 'user', content: 'Ciao' }], 8, signal);
      const quick = await stream(model, [{ role: 'user', content: 'Conta da 1 a 40 in parole.' }], 48, signal);
      const quickTps = quick.outTokens / Math.max(quick.genMs / 1000, 0.001);
      if (!quick.outTokens) throw new Error('il modello non ha risposto (runtime bloccato con questa configurazione)');
      if (bestGen > 0 && quickTps < bestGen * 0.8) {
        Object.assign(trial, { genTps: +quickTps.toFixed(1), readTps: 0, spill: true });
      } else {
        Object.assign(trial, await benchmark(model, { signal, save: false }));
        trial.spill = bestGen > 0 && trial.genTps < bestGen * 0.8;
      }
    } catch (e) {
      trial.error = e.message;
    }
    trials.push(trial);
    if (!trial.error && !trial.spill) bestGen = Math.max(bestGen, trial.genTps);
    // Contesto che sfora la VRAM con entrambe le varianti: inutile salire ancora.
    const twin = trials.find((t) => t !== trial && t.config.context_length === cfg.context_length);
    if (trial.spill && twin && (twin.spill || twin.error)) stopAbove = cfg.context_length;
    onProgress({ phase: 'trial_done', index: n + 1, total: plan.length, label, trials });
  }

  const good = trials.filter((t) => !t.error && !t.spill);
  if (!good.length) throw new Error('Nessuna configurazione è stata caricata in VRAM: il modello è troppo grande per questa GPU. Prova una quantizzazione più piccola (Q4 o IQ3).');
  // Per un agente la lettura del prompt pesa quanto la scrittura: ogni risultato di strumento va riletto.
  const top = Math.max(...good.map((t) => t.genTps));
  const topRead = Math.max(...good.map((t) => t.readTps));
  const best = good
    .filter((t) => t.genTps >= top * 0.9 && t.readTps >= topRead * 0.75)
    .sort((a, b) => b.config.context_length - a.config.context_length || b.readTps - a.readTps)[0];

  onProgress({ phase: 'finalize', label: best.label, trials });
  await loadModel(model, best.config);
  const profile = setProfile(model, {
    config: best.config,
    bench: { genTps: best.genTps, readTps: best.readTps, ttftMs: best.ttftMs, at: Date.now() },
    tunedAt: Date.now(),
    trials: trials.map(({ label, genTps, readTps, error, spill, config }) => ({ label, genTps, readTps, error, spill, ctx: config.context_length, fa: config.flash_attention })),
  });
  return { best, trials, profile };
}

// Limiti da usare nel cervello di Howl per un contesto caricato: margine per risposta e stime imprecise.
export function limitsForContext(ctx) {
  const maxTokens = Math.min(4096, Math.max(1024, Math.floor(ctx / 8)));
  return { contextLimit: Math.max(2000, Math.floor(ctx * 0.9) - maxTokens), maxTokens };
}
