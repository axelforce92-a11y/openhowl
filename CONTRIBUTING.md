# Contributing to OpenHowl

Thanks for wanting to help. OpenHowl is deliberately small and dependency-free — keep it that way and
everything else is easy.

## Getting started

```bash
npm install
copy .env.example .env      # add a key, or point it at a local model (LM Studio, Ollama…)
npm run server              # http://127.0.0.1:7777
npm run app                 # the desktop app
```

Node.js 22 or newer. `pyautogui` is only needed for the computer-use tool.

## House rules

- **No new runtime dependencies** unless there is no reasonable alternative. The whole point is that OpenHowl
  is plain Node.js you can read in an afternoon.
- **Comments in Italian**, matching the existing code; issues and pull requests can be in English or Italian.
- Comments explain *why*, not *what*. Match the density and tone of the file you are editing.
- Every tool declares a `risk` (`read` / `write` / …): read-only tools run in parallel and skip the approval prompt,
  so be honest about it.
- Anything unattended (automations, sub-agents) must **refuse** dangerous actions rather than wait for a human.

## The wolf (mascot assets)

Howl's poses are rendered images; the animation comes from splitting them into layers.

```bash
python scripts/gen_pose.py <name> "<pose description>"   # new pose with Gemini, using the existing ones as reference
python scripts/make_assets.py                            # cut out the white background -> ui/wolf/<name>.png
python scripts/make_rig.py                               # layers + eyelids -> ui/wolf/rig/ and rig.json
```

`gen_pose.py` reads a Gemini API key from `~/.openhowl/.env` (`GEMINI_API_KEY=...`). A new pose only needs to be
mapped to a state in `ui/wolf.js`; adding it to the rig (tail, head, arms, eyes) means measuring its polygons by hand
in `make_rig.py`.

## Before opening a pull request

- Try the change with both a frontier model and a small local one: most rough edges only show up with the small ones.
- Check the three surfaces you may have touched: web UI, CLI (`npm run cli`) and the desktop app.
- Keep the diff focused. Rename-everything or reformat-everything patches are hard to review.

## Reporting a bug

Tell us the model and provider you were using, the operating system, and what you asked Howl to do.
If a tool misbehaved, the conversation JSON in `~/.openhowl/sessions/` holds the exact sequence — strip anything
private before attaching it.

## Security

Found something that lets a web page, a file or a tool result take control of the agent? Please report it privately
through GitHub's security advisories instead of a public issue.
