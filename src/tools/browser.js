// Browser reale pilotato con playwright-core, usando Chrome/Edge già installati (profilo dedicato in ~/.openhowl).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

let context = null;
let page = null;

function findBrowser() {
  const candidates = [
    process.env.OPENHOWL_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

async function getPage(cfg) {
  if (page && !page.isClosed()) return page;
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { throw new Error('playwright-core non installato. Esegui: npm install   (nella cartella di OpenHowl)'); }
  if (!context) {
    try {
      context = await launchContext(chromium, cfg);
    } catch (e) {
      if (/existing browser session|sessione del browser esistente|ProcessSingleton|been closed/i.test(e.message)) {
        throw new Error('Il profilo del browser è già in uso da un\'altra istanza di OpenHowl. Chiudi l\'altra finestra (icona vicino all\'orologio → Esci) e riprova, oppure usa web_search.');
      }
      throw e;
    }
    context.on('page', (p) => { page = p; });
    context.on('close', () => { context = null; page = null; });
  }
  page = context.pages().at(-1) || (await context.newPage());
  return page;
}

async function launchContext(chromium, cfg) {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('Nessun Chrome/Edge trovato. Imposta OPENHOWL_BROWSER_PATH.');
  return chromium.launchPersistentContext(path.join(DATA_DIR, 'browser-profile'), {
    executablePath,
    headless: cfg.browserHeadless,
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
}

// Numera gli elementi interattivi visibili: il modello li usa come riferimenti ("ref").
const SNAPSHOT = (maxText) => {
  document.querySelectorAll('[data-howl-ref]').forEach((e) => e.removeAttribute('data-howl-ref'));
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[contenteditable=true],summary,[onclick]';
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
    if (r.bottom < -50 || r.top > innerHeight * 2.5) continue;
    el.setAttribute('data-howl-ref', ++n);
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.name || el.alt || '')
      .trim().replace(/\s+/g, ' ').slice(0, 80);
    const type = el.type && tag === 'input' ? `[${el.type}]` : '';
    const href = tag === 'a' ? ` → ${el.href.slice(0, 90)}` : '';
    const offscreen = r.top > innerHeight ? ' (sotto)' : '';
    out.push(`[${n}] ${tag}${type} "${label}"${href}${offscreen}`);
    if (n >= 200) break;
  }
  return {
    title: document.title,
    url: location.href,
    text: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, maxText),
    elements: out,
  };
};

async function snapshot(p, maxText = 6000) {
  await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  const s = await p.evaluate(SNAPSHOT, maxText);
  return `Pagina: ${s.title}\nURL: ${s.url}\n\n── Testo ──\n${s.text}\n\n── Elementi interattivi ──\n${s.elements.join('\n') || '(nessuno)'}`;
}

/* ── Verifiche anti-robot (CAPTCHA) ──
   Non vengono MAI risolte o aggirate in automatico: l'agente si mette in pausa e chiede all'utente di completarle. */
async function detectVerification(p) {
  const url = p.url();
  if (/google\.[a-z.]+\/sorry\/|\/recaptcha\/|challenges\.cloudflare\.com|captcha/i.test(url)) return url;
  return p.evaluate(() => {
    const frames = [...document.querySelectorAll('iframe')].map((f) => f.src || '');
    if (frames.some((s) => /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha/i.test(s))) {
      // un reCAPTCHA invisibile di sottofondo non è una verifica da risolvere: conta solo se è visibile
      const visible = [...document.querySelectorAll('iframe')].some((f) => {
        const r = f.getBoundingClientRect();
        return /recaptcha|hcaptcha|cloudflare|turnstile|arkose|funcaptcha/i.test(f.src || '') && r.width > 60 && r.height > 40;
      });
      if (visible) return 'widget di verifica';
    }
    const t = (document.body?.innerText || '').slice(0, 4000).toLowerCase();
    const phrases = ['non sono un robot', "i'm not a robot", 'i am not a robot', 'traffico insolito', 'unusual traffic',
      'verify you are human', 'verifica di essere un essere umano', 'conferma di essere un essere umano', 'checking your browser',
      'controllo del browser', 'press & hold', 'tieni premuto'];
    return phrases.find((ph) => t.includes(ph)) || null;
  }).catch(() => null);
}

async function guardVerification(p, ctx) {
  const found = await detectVerification(p);
  if (!found) return null;
  await p.bringToFront().catch(() => {});
  const outcome = await ctx.h.waitForUser({
    agent: ctx.agent?.name,
    title: 'Verifica "non sono un robot"',
    message: 'Il sito chiede di dimostrare che sei una persona. Completa la verifica nella finestra del browser: Howl riprende da solo appena è fatta.',
    url: p.url(),
    check: async () => !(await detectVerification(p)),
  });
  if (ctx.signal?.aborted) throw Object.assign(new Error('Interrotto'), { name: 'AbortError' });
  if (outcome !== 'done') {
    throw new Error(`Verifica anti-robot non completata (${outcome === 'timeout' ? 'tempo scaduto' : 'annullata dall\'utente'}). ` +
      'Non riprovare su questo sito: usa lo strumento web_search oppure un altro sito.');
  }
  return 'Nota: il sito ha chiesto una verifica anti-robot e l\'utente l\'ha completata. Continua normalmente.\n\n';
}

function locator(p, { ref, selector, text }) {
  if (ref != null) return p.locator(`[data-howl-ref="${ref}"]`).first();
  if (selector) return p.locator(selector).first();
  if (text) return p.getByText(text, { exact: false }).first();
  throw new Error('Specifica ref, selector o text');
}

const shot = async (p) => ({ media_type: 'image/jpeg', data: (await p.screenshot({ type: 'jpeg', quality: 70 })).toString('base64') });

export const browserTool = {
  name: 'browser',
  description:
    'Controlla un vero browser Chrome visibile. Azioni: navigate(url), snapshot (testo + elementi numerati [n]), ' +
    'click(ref|selector|text), type(ref|selector, text, submit?), press(key, es. "Enter"), scroll(direction), ' +
    'back, forward, screenshot, tabs, switch_tab(index), wait(ms), close. ' +
    'Dopo navigate/click ottieni lo snapshot aggiornato: usa i numeri [n] come ref. Non inserire mai password o dati di pagamento. ' +
    'Per semplici ricerche di informazioni usa web_search invece di aprire Google nel browser. ' +
    'Se compare una verifica anti-robot (CAPTCHA, "non sono un robot") NON provare mai a risolverla o aggirarla: OpenHowl mette in pausa e la fa completare all\'utente.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'back', 'forward', 'screenshot', 'tabs', 'switch_tab', 'wait', 'close'] },
      url: { type: 'string' },
      ref: { type: 'integer' },
      selector: { type: 'string' },
      text: { type: 'string' },
      submit: { type: 'boolean' },
      key: { type: 'string' },
      direction: { type: 'string', enum: ['up', 'down'] },
      index: { type: 'integer' },
      ms: { type: 'integer' },
    },
    required: ['action'],
  },
  risk: (i) => (['click', 'type', 'press'].includes(i.action) ? 'act' : 'read'),
  async run(i, ctx) {
    if (i.action === 'close') { await context?.close(); return 'Browser chiuso.'; }
    const out = await this.act(i, ctx);
    if (['close', 'tabs'].includes(i.action)) return out;
    const current = page && !page.isClosed() ? page : null;
    const note = current ? await guardVerification(current, ctx) : null;
    if (!note) return out;
    return note + (i.action === 'screenshot' ? '' : await snapshot(current));
  },
  async act(i, ctx) {
    const cfg = ctx.h.cfg;
    const p = await getPage(cfg);
    switch (i.action) {
      case 'navigate': {
        let url = i.url || '';
        if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(800);
        return snapshot(p);
      }
      case 'snapshot': return snapshot(p, 15000);
      case 'click': {
        await locator(p, i).click({ timeout: 10000 });
        await p.waitForTimeout(1200);
        return snapshot(page && !page.isClosed() ? page : p); // il click può aver aperto una nuova scheda
      }
      case 'type': {
        const loc = locator(p, { ref: i.ref, selector: i.selector });
        await loc.fill(i.text ?? '', { timeout: 10000 });
        if (i.submit) { await loc.press('Enter'); await p.waitForTimeout(1500); }
        return snapshot(p);
      }
      case 'press': await p.keyboard.press(i.key || 'Enter'); await p.waitForTimeout(800); return snapshot(p);
      case 'scroll': await p.mouse.wheel(0, i.direction === 'up' ? -700 : 700); await p.waitForTimeout(500); return snapshot(p);
      case 'back': await p.goBack({ timeout: 15000 }); return snapshot(p);
      case 'forward': await p.goForward({ timeout: 15000 }); return snapshot(p);
      case 'screenshot': return { text: `Screenshot di ${p.url()}`, images: [await shot(p)] };
      case 'tabs': return context.pages().map((t, n) => `${n}: ${t.url()}${t === p ? '  (attiva)' : ''}`).join('\n');
      case 'switch_tab': {
        const t = context.pages()[i.index];
        if (!t) throw new Error('Scheda inesistente');
        page = t; await t.bringToFront();
        return snapshot(t);
      }
      case 'wait': await p.waitForTimeout(Math.min(i.ms || 1000, 30000)); return snapshot(p);
      default: throw new Error(`Azione sconosciuta: ${i.action}`);
    }
  },
};
