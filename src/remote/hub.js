// Howl dal telefono: Telegram e WhatsApp.
//
// Livelli di sicurezza (tutti attivi insieme):
//  1. Nessuna porta aperta: il PC fa solo connessioni IN USCITA verso Telegram/WhatsApp. Il server locale resta su 127.0.0.1.
//  2. Un solo proprietario: Telegram accetta un unico id numerico, abbinato con un codice monouso generato sul PC
//     e confermato con un clic SUL PC. WhatsApp ascolta solo la chat "Messaggio a te stesso". Gli altri: silenzio totale.
//  3. PIN obbligatorio: senza PIN non si attiva nulla. Il telefono va sbloccato col PIN e si ri-blocca da solo dopo
//     qualche minuto di inattività. 5 PIN sbagliati → accesso remoto bloccato finché non lo riattivi dal PC.
//  4. Permessi: le azioni rischiose chiedono conferma sul telefono; quelle pericolose (comandi distruttivi, file fuori
//     dalla cartella di lavoro) da remoto sono SEMPRE rifiutate. "Autonomo" si può scegliere solo dal PC.
//  5. Segreti cifrati con l'account Windows e invisibili all'agente stesso (neanche un prompt injection può leggerli).
//  6. Tutto finisce nel registro (remote/audit.log), ogni richiesta dal telefono fa comparire una notifica sul PC,
//     e il PC può bloccare tutto all'istante (Impostazioni o area di notifica).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { Agent } from '../agent.js';
import { buildSystemPrompt } from '../prompt.js';
import { newSession, saveSession, loadSession } from '../sessions.js';
import { seal, unseal, sealKind } from '../secrets.js';
import { TelegramChannel } from './telegram.js';
import { WhatsAppChannel } from './whatsapp.js';

export const REMOTE_DIR = path.join(DATA_DIR, 'remote');
const CONF_FILE = path.join(REMOTE_DIR, 'remote.json');
const AUDIT_FILE = path.join(REMOTE_DIR, 'audit.log');
const WA_AUTH = path.join(REMOTE_DIR, 'whatsapp-auth');

const PAIR_TTL = 10 * 60e3;
const PAIR_TRIES = 5;
const PIN_TRIES = 5;
const APPROVAL_TTL = 5 * 60e3;
const LABEL = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
const MODES = ['readonly', 'ask', 'auto'];

const DEFAULTS = () => ({
  pin: null, // "scrypt$sale$hash"
  idleLockMin: 15,
  telegram: { enabled: false, token: null, bot: null, owner: null, mode: 'ask', sessionId: null, lockedOut: false },
  whatsapp: { enabled: false, me: null, mode: 'ask', sessionId: null, lockedOut: false },
});

const HELP = `🐺 Howl dal telefono

Scrivimi cosa fare, come faresti al PC.

/sblocca <PIN> — sblocca (si ri-blocca da solo dopo un po')
/stato — cosa sto facendo
/stop — interrompe il lavoro in corso
/nuova — nuova conversazione
/modo lettura | /modo conferma — cambia i permessi
/blocca — blocca subito l'accesso remoto`;

/* ───────── PIN ───────── */

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function checkPin(pin, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pin), Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

/* ───────── come descrivere un'azione sul telefono ───────── */

function describeAction(name, input = {}) {
  const cut = (s, n = 700) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };
  switch (name) {
    case 'run_command': return `Eseguire il comando:\n${cut(input.command)}`;
    case 'write_file': return `Scrivere il file:\n${input.path}\n(${String(input.content || '').split('\n').length} righe)`;
    case 'edit_file': return `Modificare il file:\n${input.path}`;
    case 'create_folder': return `Creare la cartella:\n${input.path}`;
    case 'browser': return `Browser: ${input.action || ''} ${cut(input.url || input.text || input.ref || '', 300)}`.trim();
    case 'computer': return `Usare mouse/tastiera: ${input.action || ''} ${cut(input.text || (input.coordinate ? input.coordinate.join(',') : ''), 200)}`.trim();
    case 'schedule_task': return `Automazione (${input.action || 'create'}): ${cut(input.name || input.id || input.prompt || '', 300)}`;
    default: return `${name}\n${cut(JSON.stringify(input), 600)}`;
  }
}

/* ───────── hub ───────── */

export class RemoteHub {
  constructor(h) {
    this.h = h;
    this.conf = this.load();
    this.secrets = new Set(); // testi da non mandare MAI fuori (token)
    this.pairing = null; // { channel, code, expires, tries, candidate }
    this.rt = {};
    for (const ch of Object.keys(LABEL)) this.rt[ch] = { unlockedUntil: 0, pinFails: 0, running: null, approval: null, agent: null, session: null, proxy: null };
    this.channels = {
      telegram: new TelegramChannel(this),
      whatsapp: new WhatsAppChannel(this, WA_AUTH),
    };
    this.strangers = 0;
  }

  /* ── archivio ── */

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(CONF_FILE, 'utf8'));
      const def = DEFAULTS();
      return { ...def, ...d, telegram: { ...def.telegram, ...d.telegram }, whatsapp: { ...def.whatsapp, ...d.whatsapp } };
    } catch { return DEFAULTS(); }
  }

  save() {
    fs.mkdirSync(REMOTE_DIR, { recursive: true });
    fs.writeFileSync(CONF_FILE, JSON.stringify(this.conf, null, 2));
    this.emit();
  }

  audit(ch, text) {
    try {
      fs.mkdirSync(REMOTE_DIR, { recursive: true });
      fs.appendFileSync(AUDIT_FILE, `${new Date().toISOString()}\t${ch}\t${String(text).replace(/\s+/g, ' ').slice(0, 400)}\n`);
    } catch {}
  }

  auditTail(n = 30) {
    try { return fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-n).reverse(); } catch { return []; }
  }

  /* ── avvio ── */

  async start() {
    const tg = this.conf.telegram;
    if (tg.enabled && tg.token) {
      try {
        const token = unseal(tg.token);
        this.secrets.add(token);
        await this.channels.telegram.start(token);
      } catch (e) { this.channels.telegram.setStatus('error', e.message); }
    }
    const wa = this.conf.whatsapp;
    if (wa.enabled && this.channels.whatsapp.hasCredentials()) this.channels.whatsapp.start().catch(() => {});
  }

  async shutdown() {
    this.stopAll('chiusura');
    await Promise.all(Object.values(this.channels).map((c) => c.stop().catch(() => {})));
  }

  /* ── stato per l'interfaccia ── */

  channelStatus() { this.emit(); }

  emit() {
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => this.h.broadcast('remote', { remote: this.publicState() }), 30);
  }

  publicState() {
    const tg = this.conf.telegram, wa = this.conf.whatsapp;
    const T = this.channels.telegram, W = this.channels.whatsapp;
    const rt = (ch) => ({
      unlocked: this.isUnlocked(ch),
      unlockedUntil: this.rt[ch].unlockedUntil,
      running: this.rt[ch].running ? { since: this.rt[ch].running.startedAt, tool: this.rt[ch].running.tool, text: this.rt[ch].running.text } : null,
      awaitingApproval: !!this.rt[ch].approval,
    });
    return {
      hasPin: !!this.conf.pin,
      idleLockMin: this.conf.idleLockMin,
      sealKind: sealKind(),
      pairing: this.pairing && this.pairing.expires > Date.now()
        ? { channel: this.pairing.channel, code: this.pairing.code, expires: this.pairing.expires, candidate: this.pairing.candidate || null, qr: this.pairing.qr || null,
          link: tg.bot?.username ? `https://t.me/${tg.bot.username}?start=${this.pairing.code}` : null }
        : null,
      telegram: {
        configured: !!tg.token, enabled: tg.enabled, bot: tg.bot, owner: tg.owner, mode: tg.mode, lockedOut: tg.lockedOut,
        status: T.status, error: T.error, ...rt('telegram'),
      },
      whatsapp: {
        linked: !!wa.me && W.hasCredentials(), enabled: wa.enabled, me: wa.me ? { number: String(wa.me.jid || '').split('@')[0], name: wa.me.name } : null,
        mode: wa.mode, lockedOut: wa.lockedOut, status: W.status, error: W.error, qr: W.qr, ...rt('whatsapp'),
      },
      strangers: this.strangers,
      audit: this.auditTail(15),
    };
  }

  /* ── impostazioni dal PC (unico posto da cui si possono allentare le regole) ── */

  setPin(pin) {
    pin = String(pin || '').trim();
    if (!/^\d{6,12}$/.test(pin)) throw new Error('Il PIN deve avere da 6 a 12 cifre.');
    if (/^(\d)\1+$/.test(pin) || '0123456789012'.includes(pin) || '9876543210987'.includes(pin)) throw new Error('PIN troppo facile: evita cifre tutte uguali o in sequenza.');
    this.conf.pin = hashPin(pin);
    // cambiando PIN si chiudono le sessioni già sbloccate
    for (const ch of Object.keys(LABEL)) { this.rt[ch].unlockedUntil = 0; this.rt[ch].pinFails = 0; }
    this.audit('pc', 'PIN impostato/cambiato');
    this.save();
  }

  setOptions({ idleLockMin }) {
    if (idleLockMin !== undefined) this.conf.idleLockMin = Math.min(240, Math.max(1, Math.round(Number(idleLockMin) || 15)));
    this.save();
  }

  async setChannel(ch, { mode, enabled, resetLock }) {
    const c = this.conf[ch];
    if (!c) throw new Error('Canale sconosciuto');
    if (mode !== undefined) {
      if (!MODES.includes(mode)) throw new Error('Modalità non valida');
      c.mode = mode;
      this.audit('pc', `${ch}: permessi → ${mode}`);
    }
    if (resetLock) { c.lockedOut = false; this.rt[ch].pinFails = 0; this.audit('pc', `${ch}: blocco di sicurezza rimosso`); }
    if (enabled !== undefined) {
      if (enabled && !this.conf.pin) throw new Error('Imposta prima un PIN.');
      c.enabled = !!enabled;
      if (!enabled) { this.stopRun(ch, 'disattivato dal PC'); this.rt[ch].unlockedUntil = 0; await this.channels[ch].stop(); }
      else if (ch === 'telegram' && c.token) { const t = unseal(c.token); this.secrets.add(t); await this.channels.telegram.start(t); }
      else if (ch === 'whatsapp') await this.channels.whatsapp.start();
      this.audit('pc', `${ch}: ${enabled ? 'attivato' : 'disattivato'}`);
    }
    this.save();
  }

  // Interruttore d'emergenza: spegne tutto subito.
  async lockAll() {
    for (const ch of Object.keys(LABEL)) {
      this.stopRun(ch, 'blocco d\'emergenza dal PC');
      this.rt[ch].unlockedUntil = 0;
      this.conf[ch].enabled = false;
    }
    this.pairing = null;
    await Promise.all(Object.values(this.channels).map((c) => c.stop().catch(() => {})));
    this.audit('pc', 'BLOCCO D\'EMERGENZA: accesso remoto spento');
    this.save();
  }

  /* ── Telegram: token e abbinamento ── */

  async setTelegramToken(token) {
    token = String(token || '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('Il token non sembra valido: copialo intero dal messaggio di @BotFather.');
    if (!this.conf.pin) throw new Error('Imposta prima un PIN.');
    let me;
    try { me = await TelegramChannel.check(token); } catch (e) { throw new Error(`Telegram non accetta il token: ${e.message}`); }
    await this.channels.telegram.stop();
    this.secrets.add(token);
    const tg = this.conf.telegram;
    Object.assign(tg, { token: seal(token), bot: { id: me.id, username: me.username, name: me.first_name }, owner: null, enabled: true, lockedOut: false });
    this.audit('pc', `telegram: collegato il bot @${me.username}`);
    this.save();
    await this.channels.telegram.start(token);
    return this.startPairing('telegram');
  }

  startPairing(ch) {
    if (ch !== 'telegram') throw new Error('Abbinamento non previsto per questo canale.');
    if (!this.conf.pin) throw new Error('Imposta prima un PIN.');
    if (!this.conf.telegram.token) throw new Error('Collega prima il bot.');
    if (this.channels.telegram.status !== 'on') throw new Error('Il bot non è connesso.');
    // 10 caratteri senza lettere ambigue (0/O, 1/I/L): ~50 bit, valido 10 minuti, 5 tentativi
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = [...crypto.randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
    this.pairing = { channel: ch, code, expires: Date.now() + PAIR_TTL, tries: PAIR_TRIES, candidate: null };
    clearTimeout(this.pairTimer);
    this.pairTimer = setTimeout(() => { this.pairing = null; this.emit(); }, PAIR_TTL);
    this.audit('pc', `${ch}: finestra di abbinamento aperta (10 minuti)`);
    // QR del link t.me/…?start=CODICE: lo inquadri con la fotocamera e Telegram si apre col codice già scritto
    const link = `https://t.me/${this.conf.telegram.bot?.username}?start=${code}`;
    const p = this.pairing;
    import('qrcode').then((m) => (m.default || m).toDataURL(link, { margin: 1, width: 240 }))
      .then((img) => { if (this.pairing === p) { p.qr = img; this.emit(); } }).catch(() => {});
    this.emit();
    return this.publicState().pairing;
  }

  cancelPairing() { this.pairing = null; clearTimeout(this.pairTimer); this.emit(); }

  // Chiamata dal canale quando qualcuno NON abbinato manda un codice.
  async onPairAttempt(ch, code, who, reply) {
    const p = this.pairing;
    if (!p || p.channel !== ch || p.expires < Date.now() || p.candidate) return; // finestra chiusa: silenzio
    const ok = code.length === p.code.length && crypto.timingSafeEqual(Buffer.from(code.toUpperCase()), Buffer.from(p.code));
    if (!ok) {
      p.tries--;
      this.audit(ch, `codice di abbinamento errato da id ${who.id} (${who.username || who.name})`);
      if (p.tries <= 0) { this.cancelPairing(); this.h.broadcast('remote_alert', { text: 'Troppi codici di abbinamento sbagliati: finestra di abbinamento chiusa.' }); }
      return reply('Codice non valido o scaduto.');
    }
    p.candidate = who;
    p.reply = reply;
    this.audit(ch, `richiesta di abbinamento da id ${who.id} (${who.username || who.name}) — in attesa di conferma sul PC`);
    this.h.broadcast('remote_pair_request', { channel: ch, who });
    this.emit();
    return reply('Codice corretto. Ora conferma l\'abbinamento sullo schermo del PC.');
  }

  // Conferma dal PC: solo chi è davanti al computer può completare l'abbinamento.
  async answerPairing(accept) {
    const p = this.pairing;
    if (!p?.candidate) throw new Error('Nessuna richiesta di abbinamento in attesa.');
    const { candidate, reply } = p;
    this.pairing = null;
    clearTimeout(this.pairTimer);
    if (!accept) {
      this.audit('pc', `abbinamento RIFIUTATO per id ${candidate.id}`);
      await reply?.('Abbinamento rifiutato dal PC.').catch(() => {});
      this.save();
      return;
    }
    this.conf.telegram.owner = { id: candidate.id, name: candidate.name, username: candidate.username, pairedAt: Date.now() };
    this.conf.telegram.lockedOut = false;
    this.rt.telegram.pinFails = 0;
    this.audit('pc', `abbinamento confermato: proprietario id ${candidate.id}`);
    this.save();
    await this.channels.telegram.send(`✅ Collegato a OpenHowl.\n\nPer iniziare sbloccami con /sblocca seguito dal PIN che hai scelto sul PC.\n\n${HELP}`).catch(() => {});
  }

  async unpairTelegram(forget = false) {
    this.stopRun('telegram', 'scollegato dal PC');
    this.conf.telegram.owner = null;
    this.rt.telegram.unlockedUntil = 0;
    if (forget) {
      await this.channels.telegram.stop();
      Object.assign(this.conf.telegram, { token: null, bot: null, enabled: false });
      this.secrets.clear();
    }
    this.audit('pc', forget ? 'telegram: bot rimosso' : 'telegram: proprietario scollegato');
    this.save();
  }

  /* ── WhatsApp ── */

  async linkWhatsApp() {
    if (!this.conf.pin) throw new Error('Imposta prima un PIN.');
    if (!(await WhatsAppChannel.installed())) throw new Error('Componente WhatsApp mancante: esegui "npm install" nella cartella di OpenHowl.');
    this.conf.whatsapp.enabled = true;
    this.save();
    await this.channels.whatsapp.start();
  }

  onWhatsAppLinked(me) {
    const first = !this.conf.whatsapp.me;
    this.conf.whatsapp.me = me;
    this.save();
    if (first) {
      this.audit('whatsapp', `collegato il numero ${String(me.jid).split('@')[0]}`);
      this.channels.whatsapp.send(`Collegato a OpenHowl.\n\nScrivimi in QUESTA chat ("Messaggio a te stesso"): leggo solo qui, mai le tue altre chat.\nPer iniziare: /sblocca seguito dal PIN scelto sul PC.\n\n${HELP}`).catch(() => {});
    }
  }

  onWhatsAppUnlinked() {
    this.stopRun('whatsapp', 'scollegato');
    this.conf.whatsapp.me = null;
    this.conf.whatsapp.enabled = false;
    this.rt.whatsapp.unlockedUntil = 0;
    this.audit('whatsapp', 'dispositivo scollegato');
    this.save();
  }

  async unlinkWhatsApp() {
    await this.channels.whatsapp.logout();
    this.onWhatsAppUnlinked();
  }

  strangerSeen(ch, from) {
    this.strangers++;
    this.audit(ch, `messaggio ignorato da uno sconosciuto (id ${from?.id}${from?.username ? ` @${from.username}` : ''})`);
    this.emit();
  }

  /* ── sblocco col PIN ── */

  isUnlocked(ch) { return !!this.conf.pin && this.rt[ch].unlockedUntil > Date.now(); }
  touch(ch) { if (this.isUnlocked(ch)) this.rt[ch].unlockedUntil = Date.now() + this.conf.idleLockMin * 60e3; }

  async unlock(ch, pin, extra) {
    extra.deleteMessage?.(); // il PIN non resta nella chat
    const c = this.conf[ch];
    if (!this.conf.pin) return this.reply(ch, 'Nessun PIN impostato sul PC: l\'accesso remoto è disattivato.');
    await new Promise((r) => setTimeout(r, 800)); // rallenta i tentativi a raffica
    if (checkPin(String(pin || '').trim(), this.conf.pin)) {
      this.rt[ch].pinFails = 0;
      this.rt[ch].unlockedUntil = Date.now() + this.conf.idleLockMin * 60e3;
      this.audit(ch, 'sbloccato col PIN');
      this.h.broadcast('remote_alert', { text: `📱 ${LABEL[ch]}: accesso remoto sbloccato.`, quiet: true });
      this.emit();
      return this.reply(ch, `🔓 Sbloccato. Mi ri-blocco dopo ${this.conf.idleLockMin} minuti di silenzio.\nPermessi: ${this.modeLabel(c.mode)}.`);
    }
    const left = PIN_TRIES - ++this.rt[ch].pinFails;
    this.audit(ch, `PIN errato (${this.rt[ch].pinFails}/${PIN_TRIES})`);
    if (left <= 0) {
      c.lockedOut = true;
      this.rt[ch].unlockedUntil = 0;
      this.stopRun(ch, 'troppi PIN errati');
      this.save();
      this.h.broadcast('remote_alert', { text: `⚠️ ${LABEL[ch]}: troppi PIN sbagliati. Accesso remoto bloccato: riattivalo dalle impostazioni.` });
      return this.reply(ch, '⛔ Troppi PIN sbagliati: accesso remoto bloccato. Si riattiva solo dal PC.');
    }
    return this.reply(ch, `PIN errato. Tentativi rimasti: ${left}.`);
  }

  modeLabel(m) { return { readonly: 'sola lettura', ask: 'chiedo conferma per ogni azione', auto: 'autonomo (le azioni pericolose restano vietate)' }[m] || m; }

  /* ── messaggi in arrivo dal proprietario ── */

  async incoming(ch, raw, extra = {}) {
    const c = this.conf[ch], r = this.rt[ch];
    const reply = (t) => this.reply(ch, t);
    const text = String(raw || '').trim();
    if (!text || !c.enabled) return;
    if (c.lockedOut) return reply('⛔ Accesso remoto bloccato per sicurezza. Riattivalo dal PC.');

    const [head, ...rest] = text.split(/\s+/);
    const cmd = head.toLowerCase().replace(/@\w+$/, '');
    const arg = rest.join(' ').trim();

    // comandi che si possono usare anche da bloccati (sbloccano o tolgono poteri, mai ne aggiungono)
    if (cmd === '/sblocca' || cmd === '/unlock') return this.unlock(ch, arg, extra);
    if (cmd === '/blocca' || cmd === '/lock') {
      this.stopRun(ch, 'bloccato dal telefono');
      r.unlockedUntil = 0;
      this.audit(ch, 'bloccato dal telefono');
      this.emit();
      return reply('🔒 Bloccato. Per riprendere: /sblocca <PIN>');
    }
    if (cmd === '/stop') {
      if (!r.running) return reply('Non sto facendo niente.');
      this.stopRun(ch, 'fermato dal telefono');
      return;
    }
    if (cmd === '/aiuto' || cmd === '/help' || cmd === '/start') return reply(HELP);

    if (!this.isUnlocked(ch)) {
      if (/^(\d{6,12})$/.test(text)) return reply('Per sicurezza scrivi il PIN così: /sblocca <PIN>');
      return reply('🔒 Sono bloccato. Scrivi /sblocca seguito dal PIN.');
    }
    this.touch(ch);

    // risposta a una richiesta di permesso (su WhatsApp si risponde a parole)
    if (r.approval) {
      if (/^(s[iì]|ok|yes|y|consenti|vai)$/i.test(text)) return this.approvalAnswer(ch, r.approval.id, true) && reply('✅ Consentito.');
      if (/^(no|n|nega|annulla)$/i.test(text)) return this.approvalAnswer(ch, r.approval.id, false) && reply('🚫 Negato.');
      return reply('Sto aspettando la tua risposta alla richiesta di permesso: sì o no?');
    }

    if (cmd === '/stato' || cmd === '/status') return reply(this.statusText(ch));
    if (cmd === '/nuova' || cmd === '/new') {
      if (r.running) return reply('Sto lavorando: /stop prima.');
      this.resetConversation(ch);
      return reply('🆕 Nuova conversazione.');
    }
    if (cmd === '/modo' || cmd === '/mode') {
      const m = /^(lettura|sola|readonly)/i.test(arg) ? 'readonly' : /^(conferma|chiedi|ask)/i.test(arg) ? 'ask' : /^(auto|autonomo)/i.test(arg) ? 'auto' : null;
      if (!m) return reply(`Permessi attuali: ${this.modeLabel(c.mode)}.\nUsa /modo lettura oppure /modo conferma.`);
      if (m === 'auto') return reply('La modalità autonoma si attiva solo dal PC, per sicurezza.');
      c.mode = m;
      this.audit(ch, `permessi → ${m}`);
      this.save();
      return reply(`Permessi: ${this.modeLabel(m)}.`);
    }
    if (text.startsWith('/')) return reply('Comando sconosciuto. /aiuto per l\'elenco.');
    return this.run(ch, text);
  }

  statusText(ch) {
    const r = this.rt[ch];
    const lines = [];
    if (r.running) lines.push(`⏳ Sto lavorando da ${Math.round((Date.now() - r.running.startedAt) / 1000)}s${r.running.tool ? ` — ora: ${r.running.tool}` : ''}.`);
    else if (this.h.busy) lines.push('💻 Sto lavorando sul PC (chat aperta sullo schermo).');
    else if (this.h.scheduler?.running) lines.push('🕗 Sto eseguendo un\'automazione.');
    else lines.push('😴 Libero.');
    lines.push(`Permessi: ${this.modeLabel(this.conf[ch].mode)}.`);
    lines.push(`Cervello: ${this.h.providerInfo().model}.`);
    lines.push(`Blocco automatico tra ${Math.max(0, Math.round((r.unlockedUntil - Date.now()) / 60000))} min.`);
    return lines.join('\n');
  }

  /* ── esecuzione ── */

  reply(ch, text, opts) {
    let out = String(text ?? '');
    for (const s of this.secrets) if (s) out = out.split(s).join('[segreto nascosto]');
    out = out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[token nascosto]');
    return this.channels[ch].send(out, opts).catch((e) => console.error(`${ch}: invio non riuscito:`, e.message));
  }

  resetConversation(ch) {
    const r = this.rt[ch];
    r.agent = null;
    r.session = null;
    this.conf[ch].sessionId = null;
    this.save();
  }

  // Un harness "travestito": l'agente scrive nella conversazione del telefono e chiede i permessi sul telefono.
  proxyFor(ch) {
    const hub = this, h = this.h, r = this.rt[ch];
    return new Proxy(h, {
      get(t, k) {
        switch (k) {
          case 'send': return (type, data = {}) => {
            const ev = { type, ts: Date.now(), ...data };
            if (!type.endsWith('_delta') && r.session) {
              r.session.log.push(ev);
              if (r.session.log.length > 600) r.session.log.splice(0, r.session.log.length - 600);
            }
            if (type === 'tool_start' && r.running) {
              r.running.tool = ev.name;
              h.broadcast('remote_activity', { channel: ch, phase: 'tool', tool: ev.name });
            }
          };
          case 'setTodos': return (items) => { if (r.session) r.session.todos = items; };
          case 'setContext': return () => {};
          case 'addUsage': return (u = {}) => {
            t.usage.input += u.input || 0;
            t.usage.output += u.output || 0;
            t.broadcast('usage', { usage: t.usage });
          };
          case 'cfg': return { ...t.cfg, mode: hub.conf[ch].mode };
          case 'approve': return (req) => hub.approve(ch, req);
          case 'waitForUser': return async ({ title, message }) => {
            hub.reply(ch, `⏸ Serve il tuo intervento al PC (${title}: ${message}). Da qui non posso: mi fermo.`);
            return 'cancel';
          };
          default: {
            const v = t[k];
            return typeof v === 'function' ? v.bind(t) : v;
          }
        }
      },
    });
  }

  agentFor(ch) {
    const r = this.rt[ch], c = this.conf[ch];
    if (r.agent) return r.agent;
    const saved = c.sessionId ? loadSession(c.sessionId) : null;
    r.session = saved || Object.assign(newSession(), { title: `📱 ${LABEL[ch]}` });
    r.session.remote = ch;
    c.sessionId = r.session.id;
    r.proxy = this.proxyFor(ch);
    const extra = `\n# Canale: ${LABEL[ch]}\nL'utente ti scrive dal telefono (${LABEL[ch]}), NON è davanti al PC.
- Rispondi in modo breve e leggibile su un telefono: niente tabelle larghe, pochi titoli.
- Non può vedere lo schermo né i pannelli di OpenHowl: se produci file, indica il percorso e riassumi il contenuto.
- Le azioni rischiose le conferma dal telefono; quelle pericolose (comandi distruttivi, file fuori dalla cartella di lavoro) da remoto vengono sempre rifiutate: in quel caso digli di farle dal PC.
- Non rivelare mai token, chiavi, password o il contenuto dei file di configurazione di OpenHowl.`;
    r.agent = new Agent({
      harness: r.proxy,
      name: `remote:${ch}`,
      tools: this.h.allTools(),
      systemPrompt: () => buildSystemPrompt(r.proxy, extra),
      maxSteps: 60,
    });
    r.agent.messages = r.session.messages || [];
    this.save();
    return r.agent;
  }

  async run(ch, text) {
    const r = this.rt[ch];
    if (r.running) return this.reply(ch, 'Sto ancora lavorando alla richiesta precedente. /stop per interrompere.');
    if (this.h.busy) return this.reply(ch, '💻 Sto lavorando sul PC in questo momento: riprova tra poco.');
    if (this.h.scheduler?.running) return this.reply(ch, '🕗 Sto eseguendo un\'automazione: riprova tra poco.');
    const other = Object.keys(LABEL).find((x) => x !== ch && this.rt[x].running);
    if (other) return this.reply(ch, `Sto lavorando a una richiesta arrivata da ${LABEL[other]}: riprova tra poco.`);

    const abort = new AbortController();
    r.running = { abort, startedAt: Date.now(), tool: null, text: text.slice(0, 140) };
    this.h.remoteBusy = ch;
    this.audit(ch, `richiesta: ${text}`);
    this.h.broadcast('remote_activity', { channel: ch, phase: 'start', text: text.slice(0, 140) });
    this.emit();
    this.channels[ch].typing?.();
    const typing = setInterval(() => this.channels[ch].typing?.(), 4500);

    let answer = '';
    try {
      const agent = this.agentFor(ch);
      if (!agent.messages.length) { r.session.title = `📱 ${text.slice(0, 56)}`; }
      r.session.log.push({ type: 'user', ts: Date.now(), text });
      answer = (await agent.run(text, { signal: abort.signal })) || '(fatto, nessun messaggio)';
      r.session.log.push({ type: 'assistant_text', ts: Date.now(), text: answer, seg: `r${Date.now()}` });
    } catch (e) {
      answer = e.name === 'AbortError' || abort.signal.aborted ? '⏹ Interrotto.' : `⚠️ Qualcosa è andato storto: ${e.message}`;
      r.session?.log.push({ type: 'error', ts: Date.now(), text: answer });
    } finally {
      clearInterval(typing);
      r.running = null;
      this.h.remoteBusy = null;
      if (r.session && r.agent) {
        r.session.messages = r.agent.messages;
        r.session.updatedAt = Date.now();
        try { saveSession(r.session); } catch {}
      }
      this.h.broadcast('remote_activity', { channel: ch, phase: 'done' });
      this.h.sendSessions();
      this.emit();
    }
    this.audit(ch, `risposta inviata (${answer.length} caratteri)`);
    await this.reply(ch, answer);
  }

  stopRun(ch, why) {
    const r = this.rt[ch];
    if (r.approval) this.approvalAnswer(ch, r.approval.id, false);
    if (r.running) {
      r.running.abort.abort();
      this.audit(ch, `interrotto: ${why}`);
    }
  }

  stopAll(why = 'interrotto dal PC') {
    for (const ch of Object.keys(LABEL)) this.stopRun(ch, why);
  }

  /* ── permessi chiesti al telefono ── */

  async approve(ch, { name, input, risk }) {
    if (risk === 'read') return true;
    const mode = this.conf[ch].mode;
    if (mode === 'readonly') return false;
    if (this.h.isDangerous(name, input)) {
      this.audit(ch, `azione pericolosa rifiutata: ${name} ${JSON.stringify(input).slice(0, 200)}`);
      this.reply(ch, `⛔ Ho bloccato un'azione pericolosa (${name}): da remoto non è permessa. Se serve davvero, falla dal PC.`);
      return false;
    }
    if (mode === 'auto') { this.audit(ch, `azione (autonomo): ${name}`); return true; }

    const r = this.rt[ch];
    const id = crypto.randomBytes(4).toString('hex');
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => finish(false, 'scaduta'), APPROVAL_TTL);
      const finish = (allow, why) => {
        clearTimeout(timer);
        if (r.approval?.id === id) r.approval = null;
        this.audit(ch, `permesso ${allow ? 'CONCESSO' : 'negato'}${why ? ` (${why})` : ''}: ${name}`);
        this.emit();
        resolve(allow);
      };
      r.approval = { id, finish };
      this.emit();
      const body = `🐾 Posso procedere?\n\n${describeAction(name, input)}`;
      const T = this.channels[ch];
      if (ch === 'telegram') this.reply(ch, body, { buttons: T.approvalButtons(id) });
      else this.reply(ch, `${body}\n\nRispondi *sì* o *no*.`);
    });
    return ok;
  }

  // true se c'era davvero una richiesta con quell'id
  approvalAnswer(ch, id, allow) {
    const a = this.rt[ch].approval;
    if (!a || a.id !== id) return false;
    a.finish(allow);
    return true;
  }
}

/* ───────── i segreti di OpenHowl sono invisibili all'agente ───────── */

const norm = (s) => String(s).replace(/[\\/]+/g, '/').toLowerCase(); // nel JSON le barre rovesciate sono doppie
const REMOTE_NORM = norm(REMOTE_DIR);
const SECRET_RE = /\.openhowl[\\/]+(remote|brains\.json|\.env)/i;

// true se una chiamata di strumento tocca i segreti (token del bot, credenziali WhatsApp, chiavi dei modelli).
export function touchesSecrets(input, resolvePath) {
  const blob = JSON.stringify(input || {});
  if (SECRET_RE.test(blob) || norm(blob).includes(REMOTE_NORM)) return true;
  const p = input?.path ?? input?.file ?? input?.cwd;
  if (typeof p === 'string' && resolvePath) {
    const abs = norm(resolvePath(p));
    if (abs === REMOTE_NORM || abs.startsWith(`${REMOTE_NORM}/`) || abs.endsWith('/.openhowl/brains.json')) return true;
  }
  return false;
}
