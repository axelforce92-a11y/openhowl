# OpenHowl 🐺

> 🇬🇧 [Read in English](README.md)

Agente AI **open source** che lavora davvero sul tuo computer: scrive codice, esegue comandi, cerca sul web,
naviga i siti in un vero browser, usa mouse e tastiera, delega a sub-agenti, porta a termine obiettivi lunghi con **`/goal`**
e adesso lavora **anche quando non ci sei**, grazie alle **automazioni a orario**.

Zero framework: Node.js puro, un'interfaccia web e un lupo animato — **Howl** — che ti tiene compagnia sul desktop.

## Avvio rapido

```bash
npm install                        # playwright-core: usa il Chrome/Edge già installato
python -m pip install pyautogui    # opzionale: mouse, tastiera e screenshot
copy .env.example .env             # poi inserisci la tua chiave API (oppure usa un modello locale)
npm run app                        # app desktop (Electron) con lupo e icona nell'area di notifica
npm run server                     # oppure solo il server: http://127.0.0.1:7777
npm run cli                        # oppure interfaccia da terminale
npm run dist                       # crea l'installer per Windows in dist/
```

L'installer per Windows è allegato a ogni [release](https://github.com/axelforce92-a11y/openhowl/releases).
L'app installata si aggiorna da sola: controlla le nuove versioni all'avvio e ogni 6 ore, le scarica e le installa
alla chiusura successiva. Dal menu nell'area di notifica puoi cercare un aggiornamento subito, riavviare per
installarlo, oppure disattivare l'aggiornamento automatico.

## 🕗 Automazioni: Howl lavora anche quando non ci sei

> «Ogni mattina alle 8 controlla le novità sull'AI e scrivimi il riassunto.»

Scrivilo in chat e basta: Howl usa da solo lo strumento `schedule_task`. Oppure apri
**Impostazioni → Automazioni**, o usa i comandi:

```
/task                                            elenco
/task add ogni giorno alle 8 :: cerca le novità AI e scrivimi il riassunto
/task add ogni lunedì e giovedì alle 9:30 :: prepara il riepilogo della settimana
/task add ogni 30 minuti :: controlla che il sito risponda
/task run|on|off|del|log <id>                    esegui adesso, attiva, pausa, elimina, storico
```

Come funziona:

- **Quando** — ogni giorno, certi giorni della settimana, a intervalli, o una volta sola. In chat lo scrivi in italiano
  («ogni mattina alle 8», «tra 10 minuti», «domani alle 18»).
- **Dove finisce il lavoro** — ogni esecuzione diventa una **conversazione a sé** nella barra laterale: puoi rileggere
  ogni passo, non sporca la chat aperta.
- **Il riassunto** — arriva come **notifica di sistema** e come scheda nell'interfaccia, con il link alla conversazione.
- **Appuntamenti mancati** — se il PC era spento, al riavvio Howl recupera l'esecuzione saltata (entro 12 ore), poi riprende il ritmo normale.
- **Mai due alla volta** — un compito per volta, e mai mentre stai lavorando con Howl in chat.
- **Permessi** — nessuno è davanti allo schermo, quindi Howl agisce da solo ma **rifiuta le azioni pericolose**
  (comandi distruttivi, scritture fuori dalla cartella di lavoro) invece di chiedere a vuoto. Con la modalità
  **sola lettura** il compito può soltanto leggere e cercare.

I compiti sono salvati in `~/.openhowl/tasks.json`.

## 📱 Howl dal telefono: Telegram e WhatsApp

> Sei fuori casa: «controlla se il backup di stanotte è andato a buon fine e dimmi quanto spazio resta sul disco».

Apri **Impostazioni → Howl dal telefono**, scegli un **PIN** e collega uno dei due (o tutti e due):

- **Telegram** — crei il *tuo* bot con @BotFather, incolli il token, poi abbini il tuo account con un codice
  (o un QR) che compare sullo schermo del PC. L'abbinamento si **conferma con un clic sul PC**.
- **WhatsApp** — inquadri un QR dal telefono (*Dispositivi collegati*). Howl ascolta **solo** la chat
  «Messaggio a te stesso»; le altre chat vengono scartate appena arrivano, senza leggerle né segnarle come lette.
  Usa una libreria non ufficiale (Baileys): WhatsApp in rari casi può limitare l'account.

Dal telefono: `/sblocca <PIN>`, poi scrivi normalmente. Altri comandi: `/stato`, `/stop`, `/nuova`,
`/modo lettura|conferma`, `/blocca`.

Come è protetto — solo chi ha **il tuo telefono e il tuo PIN** può usarlo:

| Livello | Cosa fa |
|---|---|
| Nessuna porta aperta | Il PC fa solo connessioni *in uscita* (long polling). Da Internet non c'è niente a cui collegarsi. |
| Un solo proprietario | Telegram accetta un solo id numerico, solo in chat privata; niente gruppi né messaggi inoltrati. Agli sconosciuti il bot non risponde nemmeno. |
| Abbinamento sul PC | Codice monouso da 10 caratteri, valido 10 minuti, 5 tentativi, più conferma sullo schermo del PC. |
| PIN obbligatorio | 6-12 cifre, salvato come hash scrypt. Il messaggio col PIN viene cancellato dalla chat. Howl si ri-blocca dopo qualche minuto di silenzio. 5 PIN sbagliati bloccano il canale finché non lo riattivi dal PC. |
| Permessi | Predefinito: ogni azione chiede conferma sul telefono. Le azioni pericolose da remoto sono **sempre** rifiutate. «Autonomo» si attiva solo dal PC. |
| Segreti | Token e credenziali WhatsApp cifrati con l'account Windows (DPAPI). Nessuno strumento dell'agente può leggere `~/.openhowl/remote`, e i token vengono oscurati da ogni risposta. |
| Visibilità | Ogni richiesta dal telefono fa comparire una notifica sul PC e finisce in `remote/audit.log`. Il pulsante **Blocca subito tutto** (anche nell'area di notifica) spegne tutto all'istante. |
| Niente arretrati | I messaggi arrivati a PC spento vengono scartati: un comando vecchio non parte da solo ore dopo. |

## 🧠 Cervelli: usa il modello che vuoi

Clicca **Modello** in basso a sinistra:

- **Rilevati sul tuo PC**: OpenHowl trova da solo LM Studio, Ollama, vLLM, llama.cpp e Jan attivi, con i loro modelli.
- **＋ Aggiungi**: qualsiasi endpoint compatibile OpenAI o Anthropic (Qwen DashScope, OpenRouter, DeepSeek, OpenAI, Claude…).
- **Prova**: verifica che il modello risponda e sappia **chiamare gli strumenti**, requisito indispensabile per un agente.
- Cambio al volo dal menu o con `/brain <nome>`.

I profili stanno in `~/.openhowl/brains.json`: le chiavi restano sul tuo PC e l'interfaccia le mostra sempre mascherate.
Per i modelli locali imposta una **finestra di contesto ≥ 32k**. OpenHowl gestisce anche le stranezze dei modelli piccoli:
`<think>` nel testo, chiamate `<tool_call>` scritte come testo, risposte vuote, percorsi Windows con le barre perse.

Preset da `.env`: `anthropic`, `deepseek`, `openai`, `openrouter`, `qwen`, `lmstudio`, `ollama`.

## Identità, skills, hooks e automazioni

Tutto in `~/.openhowl/`, modificabile a mano:

| Cosa | Dove | A cosa serve |
|---|---|---|
| **Identità** | `SOUL.md` | Carattere, tono e limiti di Howl. Sempre nel prompt. `/soul` |
| **Skills** | `skills/<nome>/SKILL.md` | Istruzioni per un lavoro specifico. Nel prompt c'è solo nome + descrizione; il corpo si carica a richiesta con lo strumento `skill`, e con `triggers:` viene suggerita da sola. `/skills` |
| **Hooks** | `hooks/*.mjs` | Intercettano ogni strumento: `beforeTool` (bloccare/modificare/approvare), `afterTool` (cambiare il risultato), `onUserMessage`. `/hooks reload` |
| **Automazioni** | `tasks.json` | Compiti a orario. `/task` |
| **Memoria** | `memory.md` | Fatti duraturi salvati dallo strumento `remember`. `/memory` |
| **Chat** | `sessions/*.json` | Storico delle conversazioni (comprese quelle delle automazioni) |
| **Modelli** | `brains.json` | Profili dei modelli |

Esempio di skill:

```markdown
---
name: report-settimanale
description: Preparare il report settimanale del team con i dati di vendita.
triggers: report, settimanale, vendite
---
# Report settimanale
1. Leggi i CSV in Documenti/vendite …
```

Esempio di hook che blocca un comando:

```js
export async function beforeTool({ name, input }) {
  if (name === 'run_command' && /docker/.test(input.command)) return { deny: 'docker non consentito' };
}
```

## Architettura

```
 UI web (ui/)  ──SSE eventi──┐          ┌── CLI (src/cli.js)
                             ▼          ▼
                     ┌─────────────────────────┐
                     │  Harness (harness.js)   │  comandi /slash, permessi, eventi, usage
                     └──┬────────┬────────┬────┘
                        │        │        │
          ┌─────────────▼┐  ┌────▼─────┐  └──► Scheduler (schedule.js)
          │ Agent loop   │  │ GoalRunner│       compiti a orario, in una sessione tutta loro
          │ (agent.js)   │◄─┤ (goal.js) │       pianifica → esegue → VERIFICA → ripete
          └──┬────────┬──┘  └───────────┘
             │        │
 ┌───────────▼──┐  ┌──▼─────────────────────────────────────────────┐
 │ providers.js │  │ tools/: fs · shell · web · browser · computer  │
 │ Anthropic /  │  │ skill · schedule_task · todo · memoria         │
 │ OpenAI-compat│  │ delegate (sub-agenti) · MCP                    │
 └──────────────┘  └────────────────────────────────────────────────┘
```

| File | Ruolo |
|---|---|
| `src/providers.js` | Streaming verso Anthropic o API compatibili OpenAI; formato interno unico a blocchi; retry; prompt caching |
| `src/agent.js` | Il loop: modello → tool → risultati → modello. Tool in sola lettura in parallelo, pulizia degli screenshot vecchi, compattazione del contesto, anti-allucinazione |
| `src/goal.js` | `/goal`: criteri verificabili, esecutore autonomo, **verificatore indipendente e scettico** con punteggio 0-100, rilevamento stallo, ripresa |
| `src/schedule.js` | Automazioni a orario: quando eseguirle, esecuzione isolata in una sessione propria, permessi senza supervisione, storico |
| `src/harness.js` | Permessi (`ask` / `auto` / `readonly`), comandi slash, bus eventi, conversazioni |
| `src/skills.js` · `src/hooks.js` | Identità, skill caricate a richiesta, hook dell'utente |
| `src/tools/` | Strumenti. `browser.js` numera gli elementi `[n]` della pagina; `computer_helper.py` usa pyautogui |
| `src/mcp.js` | Client MCP (stdio) per aggiungere strumenti esterni |
| `electron/main.cjs` | App desktop: finestra, mascotte sempre in primo piano, area di notifica, notifiche delle automazioni |
| `ui/mascot.js` | Howl sul desktop: stati animati, sguardo che segue il cursore |

## Comandi

| Comando | Cosa fa |
|---|---|
| `/goal <obiettivo> [--max N]` | Loop engineering fino al risultato verificato |
| `/goal status` · `/goal resume [--max N]` | Stato / ripresa dell'ultimo obiettivo |
| `/task …` | Automazioni a orario (vedi sopra) |
| `/stop` | Interrompe subito |
| `/mode ask\|auto\|readonly` | Livello di autonomia |
| `/brain [nome]` · `/provider <nome>` · `/model <id>` | Cambia modello al volo |
| `/skills` · `/soul` · `/hooks [reload]` | Competenze, identità, automazioni a eventi |
| `/cwd <percorso>` | Cambia cartella di lavoro |
| `/tools` · `/memory` · `/compact` · `/clear` · `/help` | Utility |

### Come funziona `/goal`

1. **Pianifica**: l'obiettivo diventa 3-7 criteri di successo *verificabili* + un piano (visibile nel pannello).
2. **Esegue**: l'agente lavora in autonomia e chiude con un report che, per ogni criterio, indica la prova.
3. **Verifica**: un *secondo agente* con contesto pulito non si fida del report: legge i file, lancia i test, assegna uno score.
4. **Ripete** passando all'esecutore ciò che manca, finché: raggiunto ✔ · limite iterazioni · stallo (3 giri senza miglioramento) · `/stop`.

Lo stato è in `~/.openhowl/goal.json`, quindi `/goal resume` riprende anche dopo un riavvio.

## Sicurezza

- Il server ascolta solo su `127.0.0.1` e richiede un token segreto: nessun sito web può comandare l'agente.
- Modalità `ask`: scritture, comandi, click e digitazione chiedono conferma. Comandi distruttivi
  (`Remove-Item -Recurse`, `format`, `git push --force`…) e scritture fuori dalla cartella di lavoro chiedono conferma **anche in `auto`**.
- Nelle **automazioni** le azioni pericolose vengono rifiutate, non messe in attesa: nessuno potrebbe confermarle.
- **Failsafe** del controllo del computer: porta il mouse nell'angolo in alto a sinistra per bloccare l'agente.
- Il prompt di sistema tratta pagine web, file e output come **dati, non istruzioni** (difesa dal prompt injection).
- Password, pagamenti e verifiche anti-robot restano sempre in mano tua.

## Personalizzazione

- `HOWL.md` o `AGENTS.md` nella cartella di lavoro → istruzioni di progetto caricate nel prompt.
- `~/.openhowl/openhowl.config.json` (opzionale):

```json
{
  "provider": "deepseek",
  "mode": "ask",
  "workspace": "C:\\Users\\tu\\progetti",
  "thinkingBudget": 8000,
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\tu\\Documents"] }
  }
}
```

## Contribuire

Segnalazioni e pull request sono benvenute: vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenza

MIT — vedi [LICENSE](LICENSE).
