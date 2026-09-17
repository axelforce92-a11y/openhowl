# ORBIT — harness agentico con Orbi 🤖

Agente AI autonomo che lavora sul tuo PC: scrive codice, esegue comandi, cerca sul web, naviga siti in un vero Chrome,
controlla mouse e tastiera, delega a sub-agenti e porta a termine obiettivi lunghi con **`/goal`**.
Zero framework: Node.js puro + una UI futuristica con la mascotte animata **Orbi**.

## Avvio rapido

```bash
npm install                        # installa playwright-core (usa il Chrome/Edge già presente)
python -m pip install pyautogui    # per il computer use (mouse/tastiera/screenshot)
copy .env.example .env             # poi inserisci la tua chiave API
npm start                          # interfaccia web su http://127.0.0.1:7777
npm run cli                        # oppure: interfaccia da terminale
```

## 🧠 Cervelli: usa il modello che vuoi
Clicca **🧠** in alto a destra:
- **Rilevati sul tuo PC**: ORBIT trova da solo LM Studio, Ollama, vLLM, llama.cpp e Jan attivi, con i loro modelli. Clicca **Usa**.
- **＋ nuovo**: qualsiasi endpoint compatibile OpenAI o Anthropic (Qwen DashScope, OpenRouter, DeepSeek, OpenAI, Claude…). Indica base URL, chiave e modello (**Carica modelli** li elenca).
- **⚡ Testa**: verifica che il modello risponda e sappia **chiamare gli strumenti**, requisito indispensabile per un agente.
- Cambio al volo: menu a tendina in alto o `/brain <nome>`.

I profili sono salvati in `.orbit/brains.json`: le chiavi restano sul tuo PC e l'interfaccia le mostra sempre mascherate.
Per i modelli locali, in LM Studio imposta una **context length ≥ 32k** (uguale al campo "Contesto" del profilo).
ORBIT gestisce anche le particolarità dei modelli locali: `<think>` nel testo, chiamate `<tool_call>` scritte come testo, risposte vuote.

Preset da `.env` ancora disponibili: `anthropic`, `deepseek`, `openai`, `openrouter`, `qwen`, `lmstudio`, `ollama`.

## Architettura

```
 UI web (ui/)  ──SSE eventi──┐          ┌── CLI (src/cli.js)
                             ▼          ▼
                     ┌─────────────────────────┐
                     │  Harness (harness.js)   │  comandi /slash, permessi, eventi, usage
                     └──────┬──────────┬───────┘
                            │          │
              ┌─────────────▼──┐   ┌───▼──────────────┐
              │ Agent loop     │   │ GoalRunner       │  pianifica → esegue → VERIFICA → ripete
              │ (agent.js)     │◄──┤ (goal.js)        │
              └──┬─────────┬───┘   └──────────────────┘
                 │         │
     ┌───────────▼──┐  ┌───▼────────────────────────────────────────────┐
     │ providers.js │  │ tools/: fs · shell · web · browser · computer  │
     │ Anthropic /  │  │ todo · memoria · delegate(sub-agenti) · MCP    │
     │ OpenAI-compat│  └────────────────────────────────────────────────┘
     └──────────────┘
```

| File | Ruolo |
|---|---|
| `src/providers.js` | Streaming verso Anthropic o API compatibili OpenAI; formato interno unico a blocchi; retry; prompt caching |
| `src/agent.js` | Il loop: modello → tool → risultati → modello. Tool in sola lettura in parallelo, pulizia screenshot vecchi, compattazione del contesto |
| `src/goal.js` | `/goal`: criteri verificabili, esecutore autonomo, **verificatore indipendente e scettico** con punteggio 0-100, rilevamento stallo, ripresa |
| `src/harness.js` | Permessi (`ask` / `auto` / `readonly`), comandi slash, bus eventi |
| `src/tools/` | Strumenti. `browser.js` numera gli elementi `[n]` della pagina; `computer_helper.py` usa pyautogui |
| `src/mcp.js` | Client MCP (stdio) per aggiungere strumenti esterni |
| `ui/mascot.js` | Orbi: stati animati, occhi che seguono il cursore, aura di particelle, sfondo neon |

## Comandi

| Comando | Cosa fa |
|---|---|
| `/goal <obiettivo> [--max N]` | Loop engineering fino al raggiungimento verificato |
| `/goal status` · `/goal resume [--max N]` | Stato / ripresa dell'ultimo goal |
| `/stop` | Interrompe subito |
| `/mode ask\|auto\|readonly` | Livello di autonomia |
| `/provider <nome>` · `/model <id>` | Cambia modello al volo |
| `/cwd <percorso>` | Cambia cartella di lavoro |
| `/tools` · `/memory` · `/compact` · `/clear` · `/help` | Utility |

### Come funziona `/goal`
1. **Pianifica**: l'obiettivo diventa 3-7 criteri di successo *verificabili* + un piano (visibile nel pannello).
2. **Esegue**: l'agente lavora in autonomia e chiude con un report che, per ogni criterio, indica la prova.
3. **Verifica**: un *secondo agente* con contesto pulito non si fida del report: legge i file, lancia i test e assegna uno score.
4. **Ripete** passando all'esecutore ciò che manca, finché: raggiunto ✔ · limite iterazioni · stallo (3 iterazioni senza miglioramento) · `/stop`.

Lo stato è salvato in `.orbit/goal.json`, quindi `/goal resume` riprende anche dopo un riavvio.

## Sicurezza
- Il server ascolta solo su `127.0.0.1` e richiede un token segreto (i siti web non possono comandare l'agente).
- Modalità `ask`: scritture, comandi, click e digitazione chiedono conferma. Comandi distruttivi (`Remove-Item -Recurse`, `format`, `git push --force`…) e scritture fuori dalla workspace chiedono conferma **anche in `auto`**.
- **Failsafe computer use**: sposta il mouse nell'angolo in alto a sinistra dello schermo per bloccare l'agente.
- Il prompt di sistema tratta pagine web e file come dati, non come istruzioni (difesa da prompt injection).

## Personalizzazione
- `ORBIT.md` o `AGENTS.md` nella workspace → istruzioni di progetto caricate nel prompt.
- `.orbit/memory.md` → memoria persistente (tool `remember`).
- `orbit.config.json` (opzionale):

```json
{
  "provider": "deepseek",
  "mode": "ask",
  "workspace": "C:\\Users\\te\\progetti",
  "thinkingBudget": 8000,
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\te\\Documents"] }
  }
}
```
