// WhatsApp: OpenHowl si collega al TUO account come "dispositivo collegato" (come WhatsApp Web),
// inquadrando un codice QR che compare solo sullo schermo del PC.
//
// Regola d'oro: Howl ascolta SOLTANTO la chat "Messaggio a te stesso" e soltanto i messaggi scritti da te.
// I messaggi dei tuoi contatti e dei gruppi vengono scartati appena arrivano: non vengono letti, salvati,
// né segnati come letti. Nessun altro può scrivere in quella chat, quindi nessun altro può comandare Howl.
//
// Nota: usa Baileys, una libreria non ufficiale. WhatsApp non la approva: in rari casi può limitare l'account.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { seal, unseal, fastSeal } from '../secrets.js';

const PREFIX = '🐺 ';
const MAX_QR = 5; // dopo 5 codici non inquadrati (~2 minuti) smettiamo di generarne

const silentLogger = {
  level: 'silent',
  child() { return silentLogger; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

// Stato di autenticazione di Baileys salvato su disco, cifrato con l'account Windows quando possibile.
async function useSealedAuthState(dir, B) {
  await fsp.mkdir(dir, { recursive: true });
  const fix = (f) => f.replace(/\//g, '__').replace(/:/g, '-');
  const locks = new Map();
  const lock = (f, fn) => {
    const prev = locks.get(f) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(f, next.catch(() => {}));
    return next;
  };
  const write = (data, f) => lock(f, () => {
    const json = JSON.stringify(data, B.BufferJSON.replacer);
    return fsp.writeFile(path.join(dir, fix(f)), fastSeal() ? seal(json) : json);
  });
  const read = (f) => lock(f, async () => {
    try {
      const raw = await fsp.readFile(path.join(dir, fix(f)), 'utf8');
      return JSON.parse(raw.startsWith('e1:') ? unseal(raw) : raw, B.BufferJSON.reviver);
    } catch { return null; }
  });
  const remove = (f) => lock(f, () => fsp.unlink(path.join(dir, fix(f))).catch(() => {}));

  const creds = (await read('creds.json')) || B.initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}.json`);
            if (type === 'app-state-sync-key' && v) v = B.proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (data) => {
          const jobs = [];
          for (const cat in data) for (const id in data[cat]) {
            const v = data[cat][id];
            jobs.push(v ? write(v, `${cat}-${id}.json`) : remove(`${cat}-${id}.json`));
          }
          await Promise.all(jobs);
        },
      },
    },
    saveCreds: () => write(creds, 'creds.json'),
  };
}

// Estrae il testo da un messaggio (anche quando è dentro i contenitori "effimero" o "vedi una volta").
function textOf(m) {
  let msg = m.message;
  for (let i = 0; i < 3 && msg; i++) {
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message;
    if (!inner) break;
    msg = inner;
  }
  if (!msg) return '';
  return msg.conversation || msg.extendedTextMessage?.text || '';
}

export class WhatsAppChannel {
  constructor(hub, authDir) {
    this.hub = hub;
    this.authDir = authDir;
    this.sock = null;
    this.B = null;
    this.status = 'off'; // off | connecting | qr | on | error
    this.error = null;
    this.qr = null; // immagine data: URL, solo per lo schermo del PC
    this.qrCount = 0;
    this.me = null; // { jid, lid, name }
    this.sent = new Set(); // id dei messaggi scritti da Howl, per non rispondere a se stesso
    this.wantRunning = false;
    this.retry = 0;
    this.retryTimer = null;
  }

  static installed() {
    return import('baileys').then(() => true, () => false);
  }

  setStatus(status, patch = {}) {
    this.status = status;
    Object.assign(this, { error: null, ...patch });
    if (status !== 'qr') this.qr = null;
    this.hub.channelStatus('whatsapp');
  }

  async start() {
    this.wantRunning = true;
    clearTimeout(this.retryTimer);
    if (this.sock) return;
    try {
      this.B ||= await import('baileys');
    } catch {
      this.setStatus('error', { error: 'Componente WhatsApp mancante: esegui "npm install" nella cartella di OpenHowl.' });
      return;
    }
    const B = this.B;
    const QR = await import('qrcode').then((m) => m.default || m).catch(() => null);
    this.setStatus('connecting');
    this.qrCount = 0;
    const { state, saveCreds } = await useSealedAuthState(this.authDir, B);
    let version;
    try { ({ version } = await B.fetchLatestBaileysVersion()); } catch { /* usa quella interna */ }
    const sock = B.makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: B.makeCacheableSignalKeyStore(state.keys, silentLogger) },
      logger: silentLogger,
      browser: B.Browsers.windows('OpenHowl'),
      markOnlineOnConnect: false, // il telefono continua a ricevere le notifiche
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false, // non scarichiamo lo storico delle tue chat
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (sock !== this.sock) return;
      if (u.qr) {
        if (++this.qrCount > MAX_QR) {
          this.stopSocket();
          this.wantRunning = false;
          this.setStatus('off', { error: 'Codice QR non inquadrato in tempo. Premi di nuovo "Collega".' });
          return;
        }
        const img = QR ? await QR.toDataURL(u.qr, { margin: 1, width: 280 }).catch(() => null) : null;
        this.setStatus('qr', { qr: img });
      }
      if (u.connection === 'open') {
        this.retry = 0;
        const jid = B.jidNormalizedUser(sock.user?.id || '');
        const lid = sock.user?.lid ? B.jidNormalizedUser(sock.user.lid) : null;
        this.me = { jid, lid, name: sock.user?.name || sock.user?.notify || '' };
        this.setStatus('on');
        this.hub.onWhatsAppLinked(this.me);
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        this.sock = null;
        if (code === B.DisconnectReason.loggedOut) {
          // scollegato dal telefono (Impostazioni → Dispositivi collegati): cancelliamo le credenziali
          await fsp.rm(this.authDir, { recursive: true, force: true }).catch(() => {});
          this.wantRunning = false;
          this.me = null;
          this.setStatus('off', { error: 'Dispositivo scollegato dal telefono.' });
          this.hub.onWhatsAppUnlinked();
          return;
        }
        if (!this.wantRunning) { this.setStatus('off'); return; }
        const delay = code === B.DisconnectReason.restartRequired ? 500 : Math.min(60000, 2000 * 2 ** this.retry++);
        this.setStatus('connecting');
        this.retryTimer = setTimeout(() => this.start().catch(() => {}), delay);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (sock !== this.sock || !this.me) return;
      if (type !== 'notify' && type !== 'append') return;
      for (const m of messages) {
        try { this.onMessage(m); } catch (e) { console.error('whatsapp:', e.message); }
      }
    });
  }

  isSelfChat(jid) {
    if (!jid || !this.me) return false;
    const n = this.B.jidNormalizedUser(jid);
    return n === this.me.jid || (!!this.me.lid && n === this.me.lid);
  }

  onMessage(m) {
    const k = m.key || {};
    // Filtro di sicurezza: solo messaggi scritti da TE, nella chat con TE STESSO. Tutto il resto si scarta subito.
    if (!k.fromMe) return;
    if (!this.isSelfChat(k.remoteJid) && !this.isSelfChat(k.remoteJidAlt)) return;
    if (this.sent.has(k.id)) return;
    // niente messaggi vecchi (sincronizzazione, riconnessione dopo ore)
    const ts = Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp) * 1000;
    if (ts && Date.now() - ts > 120000) return;
    const text = textOf(m).trim();
    if (!text || text.startsWith(PREFIX.trim())) return;
    const deleteMessage = () => this.sock?.sendMessage(this.me.jid, { delete: k }).catch(() => {});
    this.hub.incoming('whatsapp', text, { deleteMessage });
  }

  async send(text) {
    if (!this.sock || !this.me) return;
    // WhatsApp usa *un asterisco* per il grassetto
    const body = PREFIX + String(text).replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
    for (let i = 0; i < body.length; i += 60000) {
      const r = await this.sock.sendMessage(this.me.jid, { text: body.slice(i, i + 60000) });
      if (r?.key?.id) {
        this.sent.add(r.key.id);
        if (this.sent.size > 500) this.sent.delete(this.sent.values().next().value);
      }
    }
  }

  typing() {
    if (!this.sock || !this.me) return;
    this.sock.sendPresenceUpdate('composing', this.me.jid).catch(() => {});
  }

  stopSocket() {
    const s = this.sock;
    this.sock = null;
    try { s?.end(undefined); } catch {}
  }

  async stop() {
    this.wantRunning = false;
    clearTimeout(this.retryTimer);
    this.stopSocket();
    this.setStatus('off');
  }

  // Scollega davvero il dispositivo (sparisce da "Dispositivi collegati" sul telefono) e cancella le credenziali.
  async logout() {
    this.wantRunning = false;
    clearTimeout(this.retryTimer);
    const s = this.sock;
    this.sock = null;
    try { await s?.logout(); } catch {}
    try { s?.end(undefined); } catch {}
    await fsp.rm(this.authDir, { recursive: true, force: true }).catch(() => {});
    this.me = null;
    this.setStatus('off');
  }

  hasCredentials() {
    return fs.existsSync(path.join(this.authDir, 'creds.json'));
  }
}
