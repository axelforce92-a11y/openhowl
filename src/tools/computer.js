// Computer use: screenshot, mouse e tastiera sull'intero desktop, tramite l'helper Python (pyautogui).
// L'helper resta acceso in background (niente avvio di Python a ogni azione) e non apre finestre.
// Le coordinate usate dal modello sono quelle dello screenshot ridimensionato: la conversione avviene nell'helper.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX_W = 1280;
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'computer_helper.py');
const PYTHON = process.env.OPENHOWL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

let worker = null;
let queue = Promise.resolve();

function getWorker() {
  if (worker && worker.child.exitCode === null) return worker;
  const child = spawn(PYTHON, [HELPER, '--serve'], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }, windowsHide: true });
  const w = { child, waiting: null, err: '' };
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const cb = w.waiting;
    w.waiting = null;
    try { cb?.resolve(JSON.parse(line)); } catch { cb?.reject(new Error(line)); }
  });
  child.stderr.on('data', (d) => { w.err = (w.err + d).slice(-2000); });
  child.on('error', (e) => { w.waiting?.reject(new Error(`Impossibile avviare Python (${PYTHON}): ${e.message}`)); w.waiting = null; });
  child.on('exit', () => {
    w.waiting?.reject(new Error(w.err.trim().split('\n').at(-1) || 'helper Python terminato'));
    w.waiting = null;
  });
  worker = w;
  return w;
}

function request(args, signal) {
  const task = () => new Promise((resolve, reject) => {
    const w = getWorker();
    const onAbort = () => { w.child.kill(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    w.waiting = {
      resolve: (r) => { signal?.removeEventListener('abort', onAbort); r.ok ? resolve(r.info) : reject(new Error(r.error)); },
      reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
    };
    w.child.stdin.write(JSON.stringify(args) + '\n');
  });
  const p = queue.then(task, task);
  queue = p.catch(() => {});
  return p;
}

export function shutdownComputer() { worker?.child.kill(); }

export const computerTool = {
  name: 'computer',
  description:
    'Controlla il desktop del PC (mouse, tastiera, schermo). Azioni: screenshot; click(x,y,button?,clicks?); move(x,y); ' +
    'drag(x,y,x2,y2); scroll(x,y,amount: positivo=su, negativo=giù); type(text); key(combo, es. "ctrl+s", "alt+tab", "enter", "win+r"); wait(ms). ' +
    'Le coordinate sono in pixel dello screenshot più recente (max 1280px di larghezza). Fai SEMPRE uno screenshot prima di cliccare. ' +
    'Dopo ogni azione ricevi un nuovo screenshot; il cerchio magenta indica il cursore. Per i siti web preferisci il tool browser.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['screenshot', 'click', 'move', 'drag', 'scroll', 'type', 'key', 'wait'] },
      x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      clicks: { type: 'integer' },
      amount: { type: 'integer' },
      text: { type: 'string' },
      combo: { type: 'string' },
      ms: { type: 'integer' },
    },
    required: ['action'],
  },
  risk: (i) => (i.action === 'screenshot' || i.action === 'wait' ? 'read' : 'act'),
  async run(i, ctx) {
    if (i.action === 'wait') await new Promise((r) => setTimeout(r, Math.min(i.ms || 1000, 30000)));
    const out = path.join(os.tmpdir(), `openhowl-shot-${process.pid}-${Date.now()}.jpg`);
    const args = { ...i, action: i.action === 'wait' ? 'screenshot' : i.action, maxW: MAX_W, out, combo: i.combo || (i.action === 'key' ? i.text : undefined) };
    const info = await request(args, ctx.signal);
    const data = fs.readFileSync(out).toString('base64');
    fs.rm(out, () => {});
    const what = i.action === 'screenshot' || i.action === 'wait' ? 'Screenshot' : `Eseguito ${i.action}. Nuovo screenshot`;
    return { text: `${what}: ${info}`, images: [{ media_type: 'image/jpeg', data }] };
  },
};
