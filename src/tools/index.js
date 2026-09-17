// Registro strumenti + strumenti "meta": piano (todo), memoria, sub-agenti.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { fsTools } from './fs.js';
import { shellTools } from './shell.js';
import { webTools } from './web.js';
import { browserTool } from './browser.js';
import { computerTool } from './computer.js';
import { skillTool } from '../skills.js';

export const MEMORY_FILE = path.join(DATA_DIR, 'memory.md');

const metaTools = [
  {
    name: 'todo_write',
    description: 'Crea/aggiorna il piano di lavoro visibile all\'utente. Passa SEMPRE la lista completa. Stati: pending, in_progress, done. Un solo in_progress alla volta.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['text', 'status'] },
        },
      },
      required: ['items'],
    },
    risk: 'read',
    async run({ items }, ctx) {
      ctx.h.setTodos(items);
      const done = items.filter((t) => t.status === 'done').length;
      return `Piano aggiornato: ${done}/${items.length} completati.`;
    },
  },
  {
    name: 'remember',
    description: 'Salva nella memoria persistente un fatto duraturo e utile per le sessioni future (preferenze dell\'utente, percorsi importanti, decisioni). Niente dati sensibili.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
    risk: 'read',
    async run({ note }) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(MEMORY_FILE, `- (${new Date().toISOString().slice(0, 10)}) ${note.replace(/\n/g, ' ')}\n`);
      return 'Memorizzato.';
    },
  },
  {
    name: 'delegate',
    description: 'Affida un sotto-compito autonomo a un sub-agente con contesto pulito e gli stessi strumenti. Utile per ricerche ampie o lavori isolati che sporcherebbero il contesto. Descrivi il compito in modo completo: il sub-agente non vede la conversazione. Restituisce il suo report finale.',
    input_schema: { type: 'object', properties: { task: { type: 'string' }, name: { type: 'string', description: 'etichetta breve, es. "ricerca"' } }, required: ['task'] },
    risk: 'read',
    async run({ task, name }, ctx) {
      const { Agent } = await import('../agent.js');
      const { buildSystemPrompt } = await import('../prompt.js');
      const sub = new Agent({
        harness: ctx.h,
        name: `sub:${(name || 'task').slice(0, 20)}`,
        tools: ctx.h.allTools().filter((t) => t.name !== 'delegate'),
        systemPrompt: buildSystemPrompt(ctx.h, '\n# Ruolo\nSei un sub-agente. Completa il compito in autonomia e termina con un report conciso ma completo: risultati, file toccati, eventuali problemi.'),
        maxSteps: 40,
      });
      return (await sub.run(task, { signal: ctx.signal })) || '(il sub-agente non ha prodotto un report)';
    },
  },
];

export const builtinTools = () => [...fsTools, ...shellTools, ...webTools, browserTool, computerTool, skillTool, ...metaTools];
