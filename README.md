# OpenHowl 🐺

> 🇮🇹 [Leggi in italiano](README.it.md)

An **open source AI agent** that really works on your computer: it writes code, runs commands, searches the web,
browses real websites, drives mouse and keyboard, delegates to sub-agents, sees long goals through with **`/goal`** —
and now works **while you are away**, thanks to **scheduled automations**.

No frameworks: plain Node.js, a small web UI, and an animated wolf — **Howl** — living on your desktop.

> **Note on language:** the app's interface and built-in prompts are currently in Italian, and Howl replies in
> whatever language you write to it. English (and other languages) for the UI is on the roadmap — contributions welcome.

## Quick start

```bash
npm install                        # playwright-core: reuses the Chrome/Edge you already have
python -m pip install pyautogui    # optional: mouse, keyboard and screenshots
copy .env.example .env             # then add your API key (or point it at a local model)
npm run app                        # desktop app (Electron) with the wolf and a tray icon
npm run server                     # or the server alone: http://127.0.0.1:7777
npm run cli                        # or the terminal interface
npm run dist                       # build the Windows installer into dist/
```

Windows installers are attached to every [release](https://github.com/axelforce92-a11y/openhowl/releases); the installed
app updates itself from there.

## 🕗 Automations: Howl works when you don't

> "Every morning at 8, check what's new in AI and write me the summary."

Just say it in chat: Howl reaches for the `schedule_task` tool by itself. Or open **Settings → Automazioni**,
or use the commands:

```
/task                                            list them
/task add ogni giorno alle 8 :: <what to do>     every day at 08:00
/task add ogni lunedì e giovedì alle 9:30 :: …   on given weekdays
/task add ogni 30 minuti :: …                    on an interval
/task run|on|off|del|log <id>                    run now, enable, pause, delete, history
```

How it works:

- **When** — daily, on chosen weekdays, on an interval, or once. In chat you just say it in plain words.
- **Where the work lands** — every run becomes **its own conversation** in the sidebar: you can read back every step,
  and it never pollutes the chat you have open.
- **The summary** — arrives as a **system notification** and as a card in the UI, linking to that conversation.
- **Missed appointments** — if the computer was off, Howl catches the run up at startup (within 12 hours), then resumes the normal rhythm.
- **Never two at once** — one task at a time, and never while you are working with Howl in chat.
- **Permissions** — nobody is at the screen, so Howl acts on its own but **refuses dangerous actions**
  (destructive commands, writes outside the workspace) instead of waiting for an answer that will not come.
  A task set to **read-only** can only read and search.

Tasks live in `~/.openhowl/tasks.json`.

## 📱 Howl from your phone: Telegram and WhatsApp

> You're out: "check whether last night's backup succeeded and tell me how much disk space is left."

Open **Settings → Howl from your phone** (*Howl dal telefono*), choose a **PIN**, then connect one or both:

- **Telegram** — create *your own* bot with @BotFather, paste the token, then pair your account with a code
  (or QR) shown on the PC screen. Pairing is **confirmed with a click on the PC**.
- **WhatsApp** — scan a QR from your phone (*Linked devices*). Howl listens **only** to your "Message yourself"
  chat; every other chat is dropped on arrival, never read, stored or marked as read.
  It uses an unofficial library (Baileys): in rare cases WhatsApp may restrict the account.

From the phone: `/sblocca <PIN>`, then write normally. Other commands: `/stato`, `/stop`, `/nuova`,
`/modo lettura|conferma`, `/blocca`.

How it's protected — only someone with **your phone and your PIN** can use it:

| Layer | What it does |
|---|---|
| No open ports | The PC only makes *outbound* connections (long polling). There's nothing to connect to from the Internet. |
| Single owner | Telegram accepts one numeric user id, private chat only; no groups or forwarded messages. Strangers get no reply at all. |
| Pairing on the PC | One-time 10-character code, valid 10 minutes, 5 attempts, plus confirmation on the PC screen. |
| Mandatory PIN | 6-12 digits, stored as a scrypt hash. The PIN message is deleted from the chat. Howl re-locks after a few idle minutes. 5 wrong PINs lock the channel until you re-enable it on the PC. |
| Permissions | Default: every action asks for confirmation on the phone. Dangerous actions are **always** refused remotely. "Autonomous" can only be enabled on the PC. |
| Secrets | Bot token and WhatsApp credentials encrypted with your Windows account (DPAPI). No agent tool can read `~/.openhowl/remote`, and tokens are redacted from every reply. |
| Visibility | Every phone request shows a notification on the PC and is written to `remote/audit.log`. **Lock everything now** (also in the tray menu) shuts it all down instantly. |
| No backlog | Messages sent while the PC was off are discarded: an old command never fires hours later. |

## 🧠 Brains: run any model

Click **Modello** at the bottom left:

- **Detected on your PC**: OpenHowl finds running LM Studio, Ollama, vLLM, llama.cpp and Jan instances, with their models.
- **Add**: any OpenAI-compatible or Anthropic endpoint (Qwen DashScope, OpenRouter, DeepSeek, OpenAI, Claude…).
- **Test**: checks that the model answers *and* can **call tools** — non-negotiable for an agent.
- Switch on the fly from the menu or with `/brain <name>`.

Profiles live in `~/.openhowl/brains.json`; keys stay on your machine and the UI always shows them masked.
For local models set a **context window ≥ 32k**. OpenHowl also copes with what small models do: `<think>` blocks in
the text, `<tool_call>` calls written as plain text, empty replies, Windows paths that lost their backslashes.

`.env` presets: `anthropic`, `deepseek`, `openai`, `openrouter`, `qwen`, `lmstudio`, `ollama`.

## Identity, skills, hooks and automations

Everything lives in `~/.openhowl/`, editable by hand:

| What | Where | What it does |
|---|---|---|
| **Identity** | `SOUL.md` | Howl's character, tone and limits. Always in the prompt. `/soul` |
| **Skills** | `skills/<name>/SKILL.md` | Instructions for one kind of job. Only name + description sit in the prompt; the body is loaded on demand with the `skill` tool, and `triggers:` makes it suggest itself. `/skills` |
| **Hooks** | `hooks/*.mjs` | Intercept every tool: `beforeTool` (deny/rewrite/auto-approve), `afterTool` (rewrite the result), `onUserMessage`. `/hooks reload` |
| **Automations** | `tasks.json` | Scheduled tasks. `/task` |
| **Memory** | `memory.md` | Durable facts saved by the `remember` tool. `/memory` |
| **Chats** | `sessions/*.json` | Conversation history, automation runs included |
| **Models** | `brains.json` | Model profiles |

A skill:

```markdown
---
name: weekly-report
description: Prepare the team's weekly report from the sales data.
triggers: report, weekly, sales
---
# Weekly report
1. Read the CSVs in Documents/sales …
```

A hook that blocks a command:

```js
export async function beforeTool({ name, input }) {
  if (name === 'run_command' && /docker/.test(input.command)) return { deny: 'docker not allowed' };
}
```

## Architecture

```
 Web UI (ui/)  ──SSE events──┐          ┌── CLI (src/cli.js)
                             ▼          ▼
                     ┌─────────────────────────┐
                     │  Harness (harness.js)   │  slash commands, permissions, events, usage
                     └──┬────────┬────────┬────┘
                        │        │        │
          ┌─────────────▼┐  ┌────▼─────┐  └──► Scheduler (schedule.js)
          │ Agent loop   │  │ GoalRunner│       scheduled tasks, each in its own session
          │ (agent.js)   │◄─┤ (goal.js) │       plan → execute → VERIFY → repeat
          └──┬────────┬──┘  └───────────┘
             │        │
 ┌───────────▼──┐  ┌──▼─────────────────────────────────────────────┐
 │ providers.js │  │ tools/: fs · shell · web · browser · computer  │
 │ Anthropic /  │  │ skill · schedule_task · todo · memory          │
 │ OpenAI-compat│  │ delegate (sub-agents) · MCP                    │
 └──────────────┘  └────────────────────────────────────────────────┘
```

| File | Role |
|---|---|
| `src/providers.js` | Streaming to Anthropic or any OpenAI-compatible API; one internal block format; retries; prompt caching |
| `src/agent.js` | The loop: model → tools → results → model. Read-only tools in parallel, old screenshots pruned, context compaction, anti-hallucination check |
| `src/goal.js` | `/goal`: verifiable criteria, autonomous executor, **independent skeptical verifier** scoring 0-100, stall detection, resume |
| `src/schedule.js` | Scheduled automations: when to run, isolated execution in its own session, unattended permissions, run history |
| `src/harness.js` | Permissions (`ask` / `auto` / `readonly`), slash commands, event bus, conversations |
| `src/skills.js` · `src/hooks.js` | Identity, lazily loaded skills, user hooks |
| `src/tools/` | Tools. `browser.js` numbers the page's elements `[n]`; `computer_helper.py` drives pyautogui |
| `src/mcp.js` | MCP client (stdio) to plug in external tools |
| `electron/main.cjs` | Desktop app: window, always-on-top mascot, tray, automation notifications, auto-update |
| `ui/mascot.js` | Howl on the desktop: animated states, eyes that follow the cursor |

## Commands

| Command | What it does |
|---|---|
| `/goal <objective> [--max N]` | Loop engineering until the result is verified |
| `/goal status` · `/goal resume [--max N]` | Status / resume of the last objective |
| `/task …` | Scheduled automations (see above) |
| `/stop` | Stop right now |
| `/mode ask\|auto\|readonly` | Level of autonomy |
| `/brain [name]` · `/provider <name>` · `/model <id>` | Switch model on the fly |
| `/skills` · `/soul` · `/hooks [reload]` | Skills, identity, event hooks |
| `/cwd <path>` | Change the working folder |
| `/tools` · `/memory` · `/compact` · `/clear` · `/help` | Utilities |

### How `/goal` works

1. **Plan**: the objective becomes 3-7 *verifiable* success criteria plus a plan (shown in the panel).
2. **Execute**: the agent works on its own and ends with a report giving evidence for each criterion.
3. **Verify**: a *second agent* with a clean context does not trust that report — it reads the files, runs the tests, and scores the work.
4. **Repeat**, handing the executor what is missing, until: achieved ✔ · iteration limit · stall (3 rounds without progress) · `/stop`.

State lives in `~/.openhowl/goal.json`, so `/goal resume` picks up even after a restart.

## Security

- The server listens on `127.0.0.1` only and requires a secret token: no website can drive the agent.
- In `ask` mode, writes, commands, clicks and typing ask for confirmation. Destructive commands
  (`Remove-Item -Recurse`, `format`, `git push --force`…) and writes outside the workspace ask **even in `auto`**.
- In **automations** dangerous actions are refused rather than queued: nobody would be there to approve them.
- Computer-use **failsafe**: move the mouse into the top-left corner of the screen to stop the agent.
- The system prompt treats web pages, files and tool output as **data, not instructions** (prompt-injection defence).
- Passwords, payments and CAPTCHAs are always left to you.

## Configuration

- `HOWL.md` or `AGENTS.md` in the working folder → project instructions loaded into the prompt.
- `~/.openhowl/openhowl.config.json` (optional):

```json
{
  "provider": "deepseek",
  "mode": "ask",
  "workspace": "C:\\Users\\you\\projects",
  "thinkingBudget": 8000,
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\you\\Documents"] }
  }
}
```

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Comments and commit messages in the codebase are in Italian; English is fine in issues and PRs.

## License

MIT — see [LICENSE](LICENSE).
