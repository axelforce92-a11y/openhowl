// Shell: una sessione PowerShell (o bash) PERSISTENTE e nascosta riceve tutti i comandi.
// Niente avvio di un processo per ogni comando, nessuna finestra, e cartella/variabili restano tra un comando e l'altro.
// Timeout o interruzione: la sessione viene terminata e ricreata al comando successivo.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';
const background = new Map(); // id -> { child, command, exit, out }
let bgCounter = 0;

function clip(s, max = 30000) {
  if (s.length <= max) return s;
  const half = max / 2;
  return `${s.slice(0, half)}\n\n… [${s.length - max} caratteri omessi] …\n\n${s.slice(-half)}`;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

const TMP = path.join(os.tmpdir(), 'openhowl');
const HOST_PS = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $req = ConvertFrom-Json $line
  $global:LASTEXITCODE = 0
  $Error.Clear()
  try {
    if ($req.cwd) { Set-Location -LiteralPath $req.cwd }
    . $req.file *>&1 | Out-String -Stream -Width 250
  } catch { $_ | Out-String -Stream -Width 250 }
  $code = if ($global:LASTEXITCODE) { $global:LASTEXITCODE } elseif ($Error.Count) { 1 } else { 0 }
  Write-Output ("<<HOWL|" + $req.id + "|" + $code + "|" + (Get-Location).Path + ">>")
}
`;
const HOST_SH = `
while IFS= read -r line; do
  id=\${line%%|*}; rest=\${line#*|}; cwd=\${rest%%|*}; file=\${rest#*|}
  [ -n "$cwd" ] && cd "$cwd"
  . "$file" 2>&1
  code=$?
  printf '<<HOWL|%s|%s|%s>>\\n' "$id" "$code" "$PWD"
done
`;

class PersistentShell {
  constructor() {
    this.child = null;
    this.seq = 0;
    this.queue = Promise.resolve();
    this.cwd = null;
  }

  ensure() {
    if (this.child && this.child.exitCode === null) return;
    fs.mkdirSync(TMP, { recursive: true });
    if (WIN) {
      const host = path.join(TMP, 'shell-host.ps1');
      fs.writeFileSync(host, HOST_PS, 'utf8');
      this.child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', host], { windowsHide: true });
    } else {
      this.child = spawn('bash', ['-c', HOST_SH], { windowsHide: true });
    }
    const child = this.child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    this.buf = '';
    child.stdout.on('data', (d) => { if (this.child === child) this.onData(d); });
    child.stderr.on('data', (d) => { if (this.child === child) this.onData(d); });
    child.on('exit', () => {
      if (this.child !== child) return; // una shell vecchia, già sostituita
      this.child = null;
      this.cwd = null;
      this.pending?.finish(null, 'la shell si è chiusa');
    });
  }

  onData(d) {
    this.buf += d;
    if (this.buf.length > 3_000_000) this.buf = this.buf.slice(-1_500_000);
    const p = this.pending;
    if (!p) return;
    const m = this.buf.match(new RegExp(`<<HOWL\\|${p.id}\\|(-?\\d+)\\|(.*?)>>\\r?\\n?`));
    if (m) {
      const out = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      this.cwd = m[2];
      p.finish({ code: Number(m[1]), out, cwd: m[2] });
    }
  }

  run(command, { cwd, timeout, signal }) {
    const task = () => new Promise((resolve) => {
      this.ensure();
      const id = ++this.seq;
      const file = path.join(TMP, `cmd-${process.pid}-${id}.${WIN ? 'ps1' : 'sh'}`);
      fs.writeFileSync(file, WIN ? '﻿' + command : command, 'utf8');
      this.buf = '';
      const started = Date.now();
      let done = false;
      const finish = (res, reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending = null;
        fs.rm(file, () => {});
        if (res) return resolve({ ...res, ms: Date.now() - started });
        // interruzione/timeout: si riparte con una shell pulita
        const out = this.buf;
        const old = this.child;
        this.child = null;
        this.cwd = null;
        killTree(old);
        resolve({ code: null, out, reason, ms: Date.now() - started });
      };
      const timer = setTimeout(() => finish(null, `TIMEOUT dopo ${timeout}ms`), timeout);
      const onAbort = () => finish(null, 'interrotto dall\'utente');
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending = { id, finish };
      const line = WIN ? JSON.stringify({ id, file, cwd: cwd || '' }) : `${id}|${cwd || ''}|${file}`;
      this.child.stdin.write(line + '\n');
    });
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }
}

const shell = new PersistentShell();

export const shellTools = [
  {
    name: 'run_command',
    description: `Esegue un comando ${WIN ? 'PowerShell' : 'bash'} in una sessione persistente: cartella corrente e variabili restano tra i comandi. ` +
      'Restituisce output ed exit code. Timeout predefinito 120s. Per server o processi lunghi usa background=true e poi process_output.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'cartella in cui spostarsi prima del comando (default: resta dove sei; all\'inizio è la workspace)' },
        timeout_ms: { type: 'integer' },
        background: { type: 'boolean' },
      },
      required: ['command'],
    },
    risk: 'exec',
    async run({ command, cwd, timeout_ms = 120000, background: bg }, ctx) {
      const dir = cwd ? path.resolve(shell.cwd || ctx.workspace, cwd) : (shell.cwd ? null : ctx.workspace);
      if (bg) return startBackground(command, dir || shell.cwd || ctx.workspace);
      const r = await shell.run(command, { cwd: dir, timeout: timeout_ms, signal: ctx.signal });
      const out = r.out.replace(/\s+$/, '');
      if (r.code === null) return `Comando fermato (${r.reason}). La shell è stata riavviata.\n${clip(out) || '(nessun output)'}`;
      const where = r.cwd && path.resolve(r.cwd) !== path.resolve(ctx.workspace) ? `\ncartella attuale: ${r.cwd}` : '';
      return `exit code: ${r.code} · ${r.ms}ms${where}\n${clip(out) || '(nessun output)'}`;
    },
  },
  {
    name: 'process_output',
    description: 'Gestisce i processi avviati con background=true: action "list", "read" (output recente) o "kill".',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['list', 'read', 'kill'] }, id: { type: 'string' } },
      required: ['action'],
    },
    risk: (i) => (i.action === 'kill' ? 'exec' : 'read'),
    async run({ action, id }) {
      if (action === 'list') {
        return [...background.entries()].map(([k, v]) => `${k}  pid=${v.child.pid}  ${v.exit === null ? 'in esecuzione' : `terminato (${v.exit})`}  ${v.command}`).join('\n') || 'Nessun processo.';
      }
      const e = background.get(id);
      if (!e) throw new Error(`Processo ${id} non trovato`);
      if (action === 'kill') { killTree(e.child); return `Terminato ${id}`; }
      return `${e.exit === null ? 'in esecuzione' : `terminato (exit ${e.exit})`}\n${clip(e.out, 15000)}`;
    },
  },
];

function startBackground(command, cwd) {
  const child = WIN
    ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { cwd, windowsHide: true })
    : spawn('bash', ['-lc', command], { cwd });
  child.stdin.end();
  const id = `bg${++bgCounter}`;
  const entry = { child, command, exit: null, out: '' };
  const add = (d) => { entry.out += d; if (entry.out.length > 2_000_000) entry.out = entry.out.slice(-1_000_000); };
  child.stdout.setEncoding('utf8').on('data', add);
  child.stderr.setEncoding('utf8').on('data', add);
  child.on('close', (code) => { entry.exit = code; });
  background.set(id, entry);
  return new Promise((r) => setTimeout(() => r(`Avviato in background: id=${id} pid=${child.pid}\nOutput iniziale:\n${clip(entry.out, 4000) || '(nessuno)'}`), 2500));
}

export function shutdownShells() {
  killTree(shell.child);
  for (const e of background.values()) killTree(e.child);
}

// Comandi che richiedono SEMPRE conferma, anche in modalità auto.
const DANGER = [
  /\brm\s+-[a-z]*r[a-z]*f?\b.*(\s\/|~|\*)/i, /\bRemove-Item\b.*-Recurse/i, /\brd\s+\/s\b/i, /\brmdir\s+\/s\b/i, /\bdel\s+\/[sq]/i,
  /\bformat(-volume)?\s+[a-z]:?/i, /\bdiskpart\b/i, /\bmkfs\b/i, /\bdd\s+if=/i, /\bbcdedit\b/i, /\breg\s+delete\b/i,
  /\b(shutdown|Stop-Computer|Restart-Computer)\b/i, /\bSet-ExecutionPolicy\b/i, /\bcipher\s+\/w/i,
  /\bgit\s+push\b.*--force/i, /\bgit\s+reset\s+--hard/i, /\b(iex|Invoke-Expression)\b/i, /\|\s*(sh|bash)\b/i,
  /\bnpm\s+publish\b/i, /\bClear-RecycleBin\b/i, /\bDisable-/i, /\bnet\s+user\b/i,
];
export const isDangerousCommand = (cmd = '') => DANGER.some((re) => re.test(cmd));
