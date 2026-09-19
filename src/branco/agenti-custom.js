import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';

const BRANCO_DIR = path.join(DATA_DIR, 'branco');
const MONDO_FILE = path.join(BRANCO_DIR, 'mondo.json');
const FONDATORI_FILE = path.join(BRANCO_DIR, 'fondatori.json');

export function loadMondo() {
  try {
    if (!fs.existsSync(MONDO_FILE)) return null;
    return JSON.parse(fs.readFileSync(MONDO_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

export function saveMondo(mondo) {
  fs.mkdirSync(BRANCO_DIR, { recursive: true });
  fs.writeFileSync(MONDO_FILE, JSON.stringify(mondo, null, 2));
  return mondo;
}

export function listFondatori() {
  try {
    if (!fs.existsSync(FONDATORI_FILE)) return [];
    return JSON.parse(fs.readFileSync(FONDATORI_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

export function saveFondatore(f) {
  const fondatori = listFondatori();
  if (!f.id) f.id = crypto.randomUUID();
  const index = fondatori.findIndex(x => x.id === f.id);
  if (index >= 0) fondatori[index] = f;
  else fondatori.push(f);
  fs.mkdirSync(BRANCO_DIR, { recursive: true });
  fs.writeFileSync(FONDATORI_FILE, JSON.stringify(fondatori, null, 2));
  return fondatori;
}

export function deleteFondatore(id) {
  let fondatori = listFondatori();
  fondatori = fondatori.filter(x => x.id !== id);
  fs.mkdirSync(BRANCO_DIR, { recursive: true });
  fs.writeFileSync(FONDATORI_FILE, JSON.stringify(fondatori, null, 2));
  return fondatori;
}

export async function generateExam(mondo, providerInfo) {
  const prompt = `Sei un esaminatore esperto. Devo addestrare un agente AI con evoluzione genetica.
L'agente deve rispondere a domande basandosi SOLO sul contesto fornito.

Ruolo dell'agente:
${mondo.ruolo}

Contesto disponibile per l'agente:
${mondo.contesto || '(nessuno)'}

Tipo di risposta attesa: ${mondo.tipoRisposta}
- 'numero': risposta numerica esatta (€, %, quantità intera)
- 'sinno': risposta "si" oppure "no"
- 'testo': parola o frase breve (max 5 parole)

Crea 6 domande per l'ESAME di selezione e 4 domande SEGRETE (mai usate per selezionare gli agenti, solo per il test finale).

Regole per le domande:
- Ogni domanda deve avere UNA risposta univoca, verificabile dal contesto
- Varia la difficoltà: 2 facili, 3 medie, 1 difficile per l'esame; 2 medie, 2 difficili per il segreto
- Le domande devono testare aspetti DIVERSI del contesto
- Le risposte devono essere deducibili SOLO dal contesto, senza conoscenze esterne

Rispondi ESCLUSIVAMENTE con JSON valido, nessun testo prima o dopo:
{
  "esame": [
    {"id": "E1", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "E2", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "E3", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "E4", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "E5", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "E6", "domanda": "...", "risposta": ..., "spiegazione": "..."}
  ],
  "segreto": [
    {"id": "S1", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "S2", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "S3", "domanda": "...", "risposta": ..., "spiegazione": "..."},
    {"id": "S4", "domanda": "...", "risposta": ..., "spiegazione": "..."}
  ]
}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `${providerInfo.baseUrl}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(providerInfo.apiKey && providerInfo.apiKey !== 'local' ? { 'Authorization': `Bearer ${providerInfo.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: providerInfo.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        })
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      let content = j.choices[0].message.content.trim();
      if (content.startsWith('\`\`\`json')) content = content.replace(/^\`\`\`json\s*/, '').replace(/\s*\`\`\`$/, '');
      if (content.startsWith('\`\`\`')) content = content.replace(/^\`\`\`\s*/, '').replace(/\s*\`\`\`$/, '');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.esame) || parsed.esame.length !== 6) throw new Error("esame must have 6 questions");
      if (!Array.isArray(parsed.segreto) || parsed.segreto.length !== 4) throw new Error("segreto must have 4 questions");
      return parsed;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

export async function testFondatore(fondatore, domanda, mondo, providerInfo) {
  const { buildTools, buildSystemPrompt, buildEsaminatore } = await import('./mondo.mjs');
  
  const tools = buildTools(mondo);
  const sysPrompt = buildSystemPrompt(fondatore, mondo);
  
  const messages = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: domanda.domanda }
  ];
  
  const trace = [];
  let final = '';
  let nudged = false;
  const t0 = Date.now();
  let token = 0;

  for (let step = 0; step < (fondatore.passiMax || 10); step++) {
    try {
      const url = `${providerInfo.baseUrl}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(providerInfo.apiKey && providerInfo.apiKey !== 'local' ? { 'Authorization': `Bearer ${providerInfo.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: providerInfo.model,
          messages,
          tools,
          temperature: fondatore.temperatura,
          max_tokens: 1500,
          reasoning_effort: fondatore.ragionamento || 'none'
        })
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const m = j.choices[0].message;
      token += j.usage?.completion_tokens || 0;
      const calls = m.tool_calls || [];
      messages.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
      
      if (!calls.length) {
        final = m.content || '';
        if (!/RISPOSTA:/i.test(final) && !nudged) {
          nudged = true;
          messages.push({ role: 'user', content: 'Scrivi ora la conclusione con la riga RISPOSTA: <valore>.' });
          continue;
        }
        break;
      }
      
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
        
        let out = '';
        if (c.function.name === 'leggi_contesto') {
          out = mondo.contesto || '(nessun contesto)';
        } else if (c.function.name === 'calcola') {
          const e = String(args.espressione || '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/%/g, '/100');
          if (!/^[\d\s.+\-*/()]+$/.test(e)) out = 'Espressione non valida: usa solo numeri e + - * / ( ).';
          else {
            try { const v = Function(`"use strict";return (${e})`)(); out = Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : 'Risultato non valido.'; } catch { out = 'Espressione non valida.'; }
          }
        } else {
          // Fallback se usa strumenti default
          const { runTool } = await import('./mondo.mjs');
          out = runTool(c.function.name, args);
        }
        
        trace.push(`${c.function.name}(${JSON.stringify(args)}) → ${out.split('\n')[0].slice(0, 90)}`);
        messages.push({ role: 'tool', tool_call_id: c.id, content: out });
      }
    } catch (e) {
      return { id: domanda.id, ok: false, risposta: null, errore: e.message, passi: trace.length, secondi: Math.round((Date.now() - t0)/100)/10, trace, finale: final };
    }
  }
  
  const esaminatore = buildEsaminatore(mondo);
  let n = null;
  const match = final.match(/RISPOSTA:\s*([^\n]+)/i);
  if (match) n = match[1].trim();
  
  return {
    id: domanda.id,
    ok: esaminatore(n, domanda.risposta),
    risposta: n,
    passi: trace.length,
    secondi: Math.round((Date.now() - t0) / 100) / 10,
    trace: trace.slice(0, 12),
    finale: final.slice(-400)
  };
}
