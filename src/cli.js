#!/usr/bin/env node
// Interfaccia da terminale: stesso harness, eventi stampati a colori, approvazioni da tastiera.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { Harness } from './harness.js';

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const cfg = loadConfig();
const h = new Harness(cfg);
const rl = readline.createInterface({ input: stdin, output: stdout });

const FACES = { idle: '(◉‿◉)', thinking: '(◔_◔)', streaming: '(◉▿◉)', tool: '(⌐■_■)', approval: '(°_°)?', success: '(^‿^)✦', error: '(✖_✖)' };
const summary = (input) => {
  const v = input.command || input.path || input.url || input.query || input.task || input.pattern || input.action || '';
  return String(v).split('\n')[0].slice(0, 90);
};

let lineOpen = false;
const endLine = () => { if (lineOpen) { stdout.write('\n'); lineOpen = false; } };

h.on(async (ev) => {
  const tag = ev.agent && ev.agent !== 'main' ? c('90', `[${ev.agent}] `) : '';
  switch (ev.type) {
    case 'text_delta': stdout.write(ev.text); lineOpen = true; break;
    case 'assistant_text': endLine(); break;
    case 'state': if (['thinking', 'tool', 'success', 'error'].includes(ev.state) && ev.agent !== undefined) stdout.write(''); break;
    case 'tool_start': endLine(); console.log(`${tag}${c('33', '▸ ' + ev.name)} ${c('90', summary(ev.input))}`); break;
    case 'tool_end': console.log(`${tag}  ${ev.ok ? c('32', '✓') : c('31', '✗')} ${c('90', `${ev.ms}ms  ${(ev.output || '').split('\n')[0].slice(0, 100)}`)}`); break;
    case 'info': endLine(); console.log(c('36', ev.text)); break;
    case 'error': endLine(); console.log(c('31', `${FACES.error} ${ev.text}`)); break;
    case 'goal_phase': endLine(); console.log(c('95', `\n◆ GOAL [${ev.phase}] ${ev.text}`)); break;
    case 'goal_verdict': console.log(c(ev.done ? '92' : '93', `  ⚖ score ${ev.score}/100 — ${ev.done ? 'RAGGIUNTO' : ev.feedback}`)); break;
    case 'todo': console.log(c('90', ev.items.map((t) => `  ${t.status === 'done' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} ${t.text}`).join('\n'))); break;
    case 'user_action_request':
      endLine();
      console.log(c('93', `\n${FACES.approval} ${ev.title}: ${ev.message}\n   (${ev.url}) — riprendo da solo quando è fatto, Ctrl+C per annullare`));
      break;
    case 'approval_request': {
      endLine();
      console.log(c('93', `\n${FACES.approval} Permesso richiesto${ev.danger ? c('91', ' ⚠ AZIONE PERICOLOSA') : ''}: ${ev.name}`));
      console.log(c('90', JSON.stringify(ev.input, null, 2).slice(0, 1500)));
      const a = (await rl.question(c('93', '[s]ì / [t]utte per questo tool / [n]o › '))).trim().toLowerCase();
      h.resolveApproval(ev.id, a === 's' || a === 'y' || a === 't', a === 't');
      break;
    }
  }
});

rl.on('SIGINT', () => { if (h.busy) { h.stop(); } else { rl.close(); process.exit(0); } });

await h.init();
console.log(c('96', `\n  ${FACES.idle}  OpenHowl — ${cfg.provider}/${cfg.model} — permessi: ${cfg.mode}`));
console.log(c('90', `  workspace: ${cfg.workspace}\n  /help per i comandi, Ctrl+C per interrompere\n`));

for (;;) {
  const line = await rl.question(c('96', '❯ '));
  await h.handleInput(line);
  endLine();
}
