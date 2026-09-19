// Configurazione: legge .env e openhowl.config.json, definisce i provider supportati.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUserPath } from './paths.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Dati dell'utente (cervelli, memoria, goal, profilo browser) fuori dalla cartella del programma:
// così funziona anche quando OpenHowl è installato in una cartella di sola lettura.
export const DATA_DIR = process.env.OPENHOWL_HOME || path.join(os.homedir(), '.openhowl');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || !m[2]) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(DATA_DIR, '.env'));
loadEnv(path.join(ROOT, '.env'));

// kind: 'anthropic' = Messages API nativa; 'openai' = qualsiasi endpoint /chat/completions compatibile
export const PRESETS = {
  anthropic: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5', vision: true },
  deepseek: { kind: 'openai', baseUrl: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', vision: false },
  openai: { kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'gpt-5', vision: true },
  openrouter: { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', model: 'anthropic/claude-sonnet-5', vision: true },
  qwen: { kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyEnv: 'DASHSCOPE_API_KEY', model: 'qwen3.5-plus', vision: true },
  lmstudio: { kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', keyEnv: null, model: 'qwen/qwen3.5-9b', vision: false },
  ollama: { kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', keyEnv: null, model: 'qwen3.5', vision: false },
};

/* ── Cervelli personalizzati: profili salvati in ~/.openhowl/brains.json ── */
const BRAINS_FILE = path.join(DATA_DIR, 'brains.json');
export function loadBrains() {
  try { return JSON.parse(fs.readFileSync(BRAINS_FILE, 'utf8')); } catch { return { active: null, list: [] }; }
}
export function saveBrains(b) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BRAINS_FILE, JSON.stringify(b, null, 2));
}

export function loadConfig() {
  let file = {};
  const fp = [path.join(DATA_DIR, 'openhowl.config.json'), path.join(ROOT, 'openhowl.config.json')].find((f) => fs.existsSync(f)) || '';
  if (fs.existsSync(fp)) file = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const env = process.env;
  const provider = env.OPENHOWL_PROVIDER || file.provider ||
    (env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : env.OPENAI_API_KEY ? 'openai' : env.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic');
  if (!PRESETS[provider]) throw new Error(`Provider sconosciuto: ${provider}`);
  let chosen = null;
  try { chosen = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'workspace.json'), 'utf8')).corrente; } catch {}
  if (chosen && !fs.existsSync(chosen)) chosen = null;
  const workspace = resolveUserPath(process.cwd(), env.OPENHOWL_WORKSPACE || chosen || file.workspace || path.join(os.homedir(), 'OpenHowl'));
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const brains = loadBrains();
  return {
    brain: env.OPENHOWL_PROVIDER ? null : brains.list.find((b) => b.id === brains.active) || null,
    provider,
    model: env.OPENHOWL_MODEL || file.model || PRESETS[provider].model,
    baseUrl: env.OPENHOWL_BASE_URL || file.baseUrl || null,
    mode: env.OPENHOWL_MODE || file.mode || 'ask',
    sandbox: file.sandbox !== false, // cartella di lavoro protetta (predefinita)
    workspace,
    port: Number(env.OPENHOWL_PORT || file.port || 7777),
    maxSteps: Number(file.maxSteps || 80),
    contextLimit: Number(file.contextLimit || 160000),
    maxTokens: Number(file.maxTokens || 16000),
    thinkingBudget: Number(env.OPENHOWL_THINKING || file.thinkingBudget || 0),
    browserHeadless: env.OPENHOWL_BROWSER_HEADLESS === '1' || !!file.browserHeadless,
    echoReasoning: !!file.echoReasoning,
    mcpServers: file.mcpServers || {},
  };
}

export function providerInfo(cfg) {
  const b = cfg.brain;
  if (b) {
    return {
      kind: b.kind || 'openai',
      name: b.name,
      model: b.model,
      baseUrl: String(b.baseUrl || '').replace(/\/$/, ''),
      apiKey: b.apiKey || 'local',
      keyEnv: null,
      vision: !!b.vision,
      echoReasoning: !!b.echoReasoning,
    };
  }
  const p = PRESETS[cfg.provider];
  return {
    ...p,
    name: cfg.provider,
    model: cfg.model,
    baseUrl: (cfg.baseUrl || p.baseUrl).replace(/\/$/, ''),
    apiKey: p.keyEnv ? process.env[p.keyEnv] : 'ollama',
    echoReasoning: cfg.echoReasoning,
  };
}
