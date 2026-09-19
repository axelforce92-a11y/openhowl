// Telegram: il bot personale dell'utente, via Bot API in "long polling".
//
// Il PC fa solo richieste IN USCITA verso api.telegram.org: nessuna porta aperta, nessun webhook,
// niente di raggiungibile da Internet. Il bot risponde solo al suo proprietario (id numerico, chat privata);
// a chiunque altro non risponde nulla, come se fosse spento.
const API = 'https://api.telegram.org';
const POLL_S = 50;

async function call(token, method, body = {}, signal) {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    const e = new Error(j.description || `Telegram: errore HTTP ${r.status}`);
    e.code = j.error_code || r.status;
    throw e;
  }
  return j.result;
}

// Testo semplice (niente parse_mode: il Markdown del modello romperebbe l'invio). Togliamo i ** del grassetto.
const plain = (t) => String(t).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');
function chunks(text, n = 3900) {
  const out = [];
  let s = String(text);
  while (s.length > n) {
    let cut = s.lastIndexOf('\n', n);
    if (cut < n / 2) cut = n;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s.trim()) out.push(s);
  return out;
}

export class TelegramChannel {
  // hub: onUnpaired(msg, reply), incoming(ch, text, extra), approvalAnswer(ch, id, allow), channelStatus(ch, patch)
  constructor(hub) {
    this.hub = hub;
    this.token = null;
    this.abort = null;
    this.offset = 0;
    this.status = 'off'; // off | on | error
    this.error = null;
  }

  static async check(token) { return call(token, 'getMe'); }

  get ownerId() { return this.hub.conf.telegram.owner?.id || null; }

  async start(token) {
    await this.stop();
    this.token = token;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    // niente webhook e niente messaggi arretrati: un comando scritto ore fa, a PC spento, non deve partire da solo adesso
    await call(token, 'deleteWebhook', { drop_pending_updates: true });
    await call(token, 'setMyCommands', {
      commands: [
        { command: 'sblocca', description: 'Sblocca con il PIN' },
        { command: 'stato', description: 'Cosa sta facendo Howl' },
        { command: 'stop', description: 'Interrompe il lavoro in corso' },
        { command: 'nuova', description: 'Nuova conversazione' },
        { command: 'modo', description: 'sola lettura / chiedi conferma' },
        { command: 'blocca', description: 'Blocca subito l\'accesso remoto' },
        { command: 'aiuto', description: 'Comandi disponibili' },
      ],
    }).catch(() => {});
    this.setStatus('on');
    this.loop(signal);
  }

  async stop() {
    this.abort?.abort();
    this.abort = null;
    this.setStatus('off');
  }

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.hub.channelStatus('telegram');
  }

  async loop(signal) {
    let backoff = 2000;
    while (!signal.aborted) {
      try {
        const updates = await call(this.token, 'getUpdates', {
          offset: this.offset, timeout: POLL_S, allowed_updates: ['message', 'callback_query'],
        }, AbortSignal.any([signal, AbortSignal.timeout((POLL_S + 15) * 1000)]));
        backoff = 2000;
        if (this.status !== 'on') this.setStatus('on');
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try { await this.onUpdate(u); } catch (e) { console.error('telegram:', e.message); }
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e.code === 401 || e.code === 404) { this.setStatus('error', 'Token non più valido: è stato revocato da @BotFather?'); return; }
        if (e.code === 409) { this.setStatus('error', 'Un altro programma sta usando questo bot. Chiudilo, o crea un bot solo per OpenHowl.'); }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  async onUpdate(u) {
    if (u.callback_query) {
      const q = u.callback_query;
      // i pulsanti "Consenti / Nega" valgono solo se li preme il proprietario
      if (!this.ownerId || q.from?.id !== this.ownerId) return;
      const m = String(q.data || '').match(/^ap:([a-f0-9]+):([yn])$/);
      await call(this.token, 'answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      if (!m) return;
      const done = this.hub.approvalAnswer('telegram', m[1], m[2] === 'y');
      if (q.message) {
        await call(this.token, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        if (done) await this.send(m[2] === 'y' ? '✅ Consentito.' : '🚫 Negato.').catch(() => {});
      }
      return;
    }

    const msg = u.message;
    if (!msg?.from || msg.from.is_bot) return;
    // solo chat private uno-a-uno: niente gruppi, canali, messaggi inoltrati
    if (msg.chat?.type !== 'private' || msg.chat.id !== msg.from.id) return;
    if (msg.forward_origin || msg.forward_from || msg.forward_date) return;
    const text = typeof msg.text === 'string' ? msg.text : '';

    if (!this.ownerId) {
      // Non ancora abbinato: l'unica cosa che accettiamo è il codice di abbinamento generato sul PC.
      const m = text.match(/^\/(?:start|pair|abbina)\s+([A-Za-z0-9-]{6,20})\s*$/);
      if (!m) return;
      const who = { id: msg.from.id, name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), username: msg.from.username || null };
      return this.hub.onPairAttempt('telegram', m[1], who, (t) => this.sendTo(msg.chat.id, t));
    }
    if (msg.from.id !== this.ownerId) { this.hub.strangerSeen('telegram', msg.from); return; }
    if (!text) return this.send('Per ora capisco solo i messaggi di testo.');
    const deleteMessage = () => call(this.token, 'deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id }).catch(() => {});
    await this.hub.incoming('telegram', text, { deleteMessage });
  }

  async sendTo(chatId, text, { buttons } = {}) {
    const parts = chunks(plain(text));
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      await call(this.token, 'sendMessage', {
        chat_id: chatId,
        text: parts[i],
        link_preview_options: { is_disabled: true },
        ...(last && buttons ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } } : {}),
      });
    }
  }

  // Scrive al proprietario (solo a lui).
  async send(text, opts) {
    if (!this.token || !this.ownerId) return;
    return this.sendTo(this.ownerId, text, opts);
  }

  typing() {
    if (!this.token || !this.ownerId) return;
    call(this.token, 'sendChatAction', { chat_id: this.ownerId, action: 'typing' }).catch(() => {});
  }

  approvalButtons(id) {
    return [{ text: '✅ Consenti', data: `ap:${id}:y` }, { text: '🚫 Nega', data: `ap:${id}:n` }];
  }
}
