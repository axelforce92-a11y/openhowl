// Generazione di immagini in locale con Qwen Image 2.1 tramite stable-diffusion.cpp (backend Vulkan: va anche su GPU AMD).
// Componenti in ~/.openhowl/image: bin/sd-cli.exe, il codificatore di testo Qwen3-VL-8B (gguf) e il VAE di Qwen Image 2.1.
// Il modello di diffusione può stare lì oppure fra i modelli di LM Studio.
// Misurato su RX 5700 XT: ~47 s per passo a 512×512 (il codificatore di testo gira sul processore).
// Con 8 GB di VRAM il modello di chat e quello delle immagini non ci stanno insieme: liberiamo la VRAM e poi ricarichiamo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from '../config.js';
import { resolveUserPath } from '../paths.js';
import { engineStatus, loadModel, unloadAll } from '../engine.js';

export const IMAGE_DIR = path.join(DATA_DIR, 'image');

function findFile(dirs, test, depth = 3) {
  for (const dir of dirs) {
    const stack = [[dir, 0]];
    while (stack.length) {
      const [d, lvl] = stack.pop();
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isFile() && test(e.name.toLowerCase())) return p;
        if (e.isDirectory() && lvl < depth) stack.push([p, lvl + 1]);
      }
    }
  }
  return null;
}

export function imageSetup() {
  const lms = path.join(os.homedir(), '.lmstudio', 'models');
  const parts = {
    cli: fs.existsSync(path.join(IMAGE_DIR, 'bin', 'sd-cli.exe')) ? path.join(IMAGE_DIR, 'bin', 'sd-cli.exe') : null,
    diffusion: findFile([IMAGE_DIR, lms], (n) => /qwen[-_]image[-_]2\.1.*\.gguf$/.test(n)),
    llm: findFile([IMAGE_DIR], (n) => /^qwen3-?vl-8b.*\.gguf$/.test(n) && !n.includes('mmproj'), 0),
    vae: findFile([IMAGE_DIR], (n) => /qwen_image_2\.1_vae.*\.safetensors$/.test(n), 0),
  };
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  return { ...parts, ready: !missing.length, missing };
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'immagine';
const round16 = (n, def) => Math.max(256, Math.min(1536, Math.round((Number(n) || def) / 16) * 16));

export const imageTool = {
  name: 'generate_image',
  description: 'Genera un\'immagine da una descrizione testuale con Qwen Image 2.1, in locale sulla GPU dell\'utente (nessun servizio esterno). ' +
    'Scrivi il prompt in modo ricco e concreto: soggetto, stile, luce, composizione, eventuali testi da scrivere nell\'immagine tra virgolette (il modello sa scrivere testo). ' +
    'Su una GPU da 8 GB ci vogliono circa 10-15 minuti per immagine: avvisa l\'utente, genera una sola immagine per volta e solo quando l\'utente la vuole. Salva un PNG nella cartella di lavoro.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'descrizione dettagliata dell\'immagine' },
      negative_prompt: { type: 'string', description: 'cosa evitare (facoltativo)' },
      width: { type: 'integer', description: 'larghezza in pixel, multiplo di 16 (predefinita 512; 1024 richiede circa 4 volte il tempo)' },
      height: { type: 'integer', description: 'altezza in pixel, multiplo di 16 (predefinita 512)' },
      steps: { type: 'integer', description: 'passi di campionamento: più = più dettagli ma più lento (predefiniti 16)' },
      seed: { type: 'integer', description: 'seme per riprodurre la stessa immagine (facoltativo)' },
      path: { type: 'string', description: 'file PNG di destinazione, relativo alla cartella di lavoro (predefinito howl-immagini/<nome>.png)' },
    },
    required: ['prompt'],
  },
  risk: 'write',
  async run(input, ctx) {
    const setup = imageSetup();
    if (!setup.ready) {
      throw new Error(`Qwen Image non è installato del tutto (manca: ${setup.missing.join(', ')}). Servono in ${IMAGE_DIR}: bin/sd-cli.exe (stable-diffusion.cpp Vulkan), Qwen3VL-8B-Instruct-Q4_K_M.gguf e qwen_image_2.1_vae_bf16.safetensors; il modello qwen-image-2.1 può stare in LM Studio.`);
    }
    const width = round16(input.width, 512), height = round16(input.height, 512);
    const steps = Math.max(4, Math.min(50, Number(input.steps) || 16));
    const seed = Number.isInteger(input.seed) ? input.seed : Math.floor(Math.random() * 2 ** 31);
    // Percorso predefinito assoluto: "immagini" da solo verrebbe letto come la cartella Immagini di Windows (fuori dal workspace).
    const out = input.path ? resolveUserPath(ctx.workspace, input.path) : path.join(ctx.workspace, 'howl-immagini', `${slug(input.prompt)}-${Date.now().toString(36)}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    // Libera la VRAM dal modello di chat (se è locale) e ricordati di rimetterlo com'era.
    let reload = null;
    try {
      const st = await engineStatus();
      reload = st.models.find((m) => m.instances.length)?.key || null;
      if (reload) await unloadAll();
    } catch {}

    ctx.agent?.emit?.('info', { text: `🎨 Disegno ${width}×${height} con Qwen Image 2.1 (${steps} passi): sulla tua GPU ci vogliono circa ${Math.round(steps * 47 * (width * height) / (512 * 512) / 60)} minuti…` });
    const args = [
      '--diffusion-model', setup.diffusion, '--llm', setup.llm, '--vae', setup.vae,
      '-p', input.prompt, '-W', String(width), '-H', String(height),
      '--steps', String(steps), '--cfg-scale', '6.0', '--sampling-method', 'euler', '-s', String(seed),
      '--backend', 'te=cpu', '--diffusion-fa', '--vae-tiling', '-o', out,
    ];
    if (input.negative_prompt) args.push('-n', input.negative_prompt);

    const t0 = Date.now();
    let log = '';
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(setup.cli, args, { cwd: path.dirname(setup.cli), windowsHide: true });
        const onData = (d) => { log = (log + d.toString()).slice(-6000); };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        const abort = () => child.kill();
        ctx.signal?.addEventListener('abort', abort, { once: true });
        child.on('error', reject);
        child.on('close', (code) => {
          ctx.signal?.removeEventListener('abort', abort);
          if (ctx.signal?.aborted) return reject(Object.assign(new Error('Interrotto'), { name: 'AbortError' }));
          if (code === 0 && fs.existsSync(out)) resolve();
          else reject(new Error(`stable-diffusion.cpp è terminato con codice ${code}.\n${log.split('\n').filter((l) => /error|fail|out of memory|errore/i.test(l)).slice(-5).join('\n') || log.slice(-800)}`));
        });
      });
    } finally {
      if (reload) await loadModel(reload).catch(() => {});
    }

    const secs = Math.round((Date.now() - t0) / 1000);
    const data = fs.readFileSync(out).toString('base64');
    return {
      text: `Immagine creata e salvata: ${out} (${width}×${height}, ${steps} passi, seed ${seed}, ${secs} s). Mostrala all'utente indicando il percorso.`,
      images: [{ media_type: 'image/png', data }],
    };
  },
};
