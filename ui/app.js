// OpenHowl — interfaccia: riceve gli eventi dell'agente (SSE) e li trasforma in UI.
(() => {
  let TOKEN = document.querySelector('meta[name=howl-token]').content;
  const desk = window.howlDesktop;
  const $ = (id) => document.getElementById(id);
  const feed = $('feed'), input = $('input');
  if (desk) document.body.classList.add('desktop');

  let eventSource = null, tokenRefresh = null;
  async function refreshToken() {
    if (tokenRefresh) return tokenRefresh;
    tokenRefresh = (async () => {
      const html = await fetch(`/?token_refresh=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
      const fresh = html.match(/name="howl-token" content="([^"]+)"/)?.[1];
      if (!fresh) throw new Error('Impossibile aggiornare la sessione locale.');
      TOKEN = fresh;
      document.querySelector('meta[name=howl-token]').content = fresh;
      connect();
      return fresh;
    })().finally(() => { tokenRefresh = null; });
    return tokenRefresh;
  }
  const post = async (url, body) => {
    const request = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-howl-token': TOKEN }, body: JSON.stringify(body || {}) });
    let response = await request();
    if (response.status === 401) { await refreshToken(); response = await request(); }
    return response;
  };

  /* ───────── icone ───────── */
  const P = {
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    term: '<path d="m5 8 4 4-4 4"/><path d="M12 16h7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    brain: '<path d="M12 5a3 3 0 1 0-6 .1A3 3 0 0 0 4 11a3 3 0 0 0 2 5 3 3 0 0 0 6 1V5z"/><path d="M12 5a3 3 0 1 1 6 .1A3 3 0 0 1 20 11a3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    paw: '<circle cx="7" cy="9.5" r="1.7"/><circle cx="11" cy="6.6" r="1.7"/><circle cx="15.5" cy="7.4" r="1.7"/><circle cx="18.4" cy="11" r="1.7"/><path d="M8 16.2c0-2.4 2-4.3 4.5-4.3s4.5 1.9 4.5 4.3a2.8 2.8 0 0 1-2.8 2.8h-3.4A2.8 2.8 0 0 1 8 16.2z"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 6h6zM19 7l-3 6h6z"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
    hand: '<path d="M11 10V5a1.6 1.6 0 1 1 3.2 0v5M14.2 10V6.4a1.6 1.6 0 1 1 3.2 0V13M7.8 11.5V8.4a1.6 1.6 0 1 1 3.2 0V10"/><path d="M7.8 11.5v3.1a6 6 0 0 0 6 6h.6a3.4 3.4 0 0 0 3.4-3.4V13"/>',
    bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5z"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.3 1.4M9 2h6"/>',
    wiki: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="17" r="2"/><path d="m8 7 8-.7M7.3 8.6l3.5 6.7M16.8 7.7l-3.7 7.7"/>',
  };
  const ICON_OF = {
    read_file: 'file', write_file: 'pen', edit_file: 'pen', create_folder: 'folder', list_dir: 'folder', glob: 'search', grep: 'search',
    run_command: 'term', process_output: 'term', web_search: 'globe', web_fetch: 'globe', browser: 'compass',
    computer: 'mouse', todo_write: 'list', remember: 'brain', delegate: 'paw', submit_verdict: 'scale', schedule_task: 'clock', wiki: 'wiki',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24">${P[k]}</svg>`;
  const icon = (name) => svg(ICON_OF[name] || (name.startsWith('mcp__') ? 'plug' : 'cog'));

  const TOOL_SAY = {
    read_file: 'Legge un file', write_file: 'Scrive un file', edit_file: 'Modifica il codice', create_folder: 'Crea una cartella',
    run_command: 'Esegue un comando', web_search: 'Cerca sul web', web_fetch: 'Legge una pagina', browser: 'Naviga nel browser',
    computer: 'Usa il computer', delegate: 'Chiama il branco', grep: 'Cerca nel codice', glob: 'Cerca file',
    todo_write: 'Aggiorna il piano', remember: 'Prende nota', submit_verdict: 'Verifica il lavoro', schedule_task: 'Programma un\'automazione',
    list_dir: 'Esplora una cartella', process_output: 'Segue un comando', wiki: 'Consulta la Wiki', skill: 'Prepara una competenza',
  };
  const STATE_LABEL = { idle: 'Inattivo', thinking: 'Sta ragionando', streaming: 'Sta rispondendo', tool: 'Al lavoro', approval: 'Attende il tuo permesso', waiting: 'In pausa, attende te', success: 'Completato', goal: 'Obiettivo raggiunto', error: 'Errore' };
  const MODES = [
    ['readonly', 'Sola lettura', 'Può solo leggere e cercare. Non modifica nulla sul computer.', 'eye'],
    ['ask', 'Chiedi conferma', 'Chiede il permesso prima di scrivere file, eseguire comandi o usare mouse e tastiera.', 'hand'],
    ['auto', 'Autonomo', 'Agisce da solo. I comandi distruttivi chiedono comunque conferma.', 'bolt'],
  ];

  let commands = [], config = {}, replaying = false, resetTimer = null, sessions = [], currentId = null;
  let tasks = [], taskRunning = null, taskTool = null;
  let remote = null;
  const segs = new Map(), tools = new Map();
  let approvalQueue = [];

  /* ───────── stato del lupo ───────── */
  const howl = window.HowlWolf.mount($('wolfMini'), { variant: 'mini' });
  const welcomeHowl = window.HowlWolf.mount($('welcomeWolf'), { variant: 'mini', sleepAfter: 0 });
  welcomeHowl.hello();
  function wolf(state, say, opts = {}) {
    if (replaying) return;
    clearTimeout(resetTimer);
    document.body.dataset.state = state;
    $('stateLabel').textContent = say || STATE_LABEL[state] || state;
    howl.set(state, opts);
    if (state === 'success' || state === 'goal') confetti();
    if (['success', 'goal', 'error'].includes(state)) resetTimer = setTimeout(() => wolf('idle'), state === 'error' ? 4200 : 3000);
  }
  function confetti() {
    const r = $('wolfMini').getBoundingClientRect();
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
      s.style.left = `${r.left + r.width / 2}px`;
      s.style.top = `${r.top + r.height * 0.3}px`;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      s.style.background = ['#0f8b8d', '#22c55e', '#f59e0b', '#38bdf8'][i % 4];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 950);
    }
  }

  /* ───────── markdown minimale e sicuro ───────── */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  function md(src) {
    let out = '', para = [], list = null, code = null;
    const flushP = () => { if (para.length) { out += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`; para = []; } };
    const flushL = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const line of String(src).split('\n')) {
      if (code !== null) {
        if (/^\s*```/.test(line)) { out += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; } else code.push(line);
        continue;
      }
      let m;
      if (/^\s*```/.test(line)) { flushP(); flushL(); code = []; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); const l = m[1].length + 1; out += `<h${l}>${inline(m[2])}</h${l}>`; continue; }
      if ((m = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)/))) {
        flushP();
        const t = m[1] ? 'ol' : 'ul';
        if (list !== t) { flushL(); out += `<${t}>`; list = t; }
        out += `<li>${inline(m[2])}</li>`;
        continue;
      }
      if (!line.trim()) { flushP(); flushL(); continue; }
      if (/^>\s?/.test(line)) { flushP(); flushL(); out += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; continue; }
      flushL();
      para.push(line);
    }
    if (code !== null) out += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    flushP(); flushL();
    return out;
  }

  /* ───────── feed ───────── */
  const welcomeNode = $('welcome');
  const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 150;
  function add(node) {
    welcomeNode.remove();
    const stick = replaying || nearBottom();
    feed.appendChild(node);
    if (stick) feed.scrollTop = feed.scrollHeight;
    return node;
  }
  const div = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; return d; };
  const tag = (ev) => (ev.agent && ev.agent !== 'main' ? `<span class="agent-tag">${esc(ev.agent === 'verifier' ? 'verifica' : ev.agent)}</span>` : '');

  function assistantEl(ev) {
    let s = segs.get(ev.seg);
    if (!s) { s = { el: add(div('msg assistant')), raw: '', tag: tag(ev), pending: false }; segs.set(ev.seg, s); }
    return s;
  }
  const renderSeg = (s) => { s.el.innerHTML = s.tag + md(s.raw); };
  const metricTime = (ms) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  function renderResponseMetrics(ev) {
    const s = assistantEl(ev);
    let row = s.el.querySelector('.response-metrics');
    if (!row) { row = document.createElement('div'); row.className = 'response-metrics'; s.el.appendChild(row); }
    const speed = Number(ev.tokensPerSecond || 0);
    row.innerHTML = `<span class="speed">${speed.toFixed(speed >= 100 ? 0 : 1)} tok/s</span>` +
      `<span title="Tempo al primo token">primo token ${metricTime(ev.ttftMs || 0)}</span>` +
      `<span>${fmt(ev.outputTokens || 0)} token</span>` +
      `<span title="Token del prompt, inclusi cronologia e strumenti">prompt ${fmt(ev.inputTokens || 0)}</span>` +
      `<span>totale ${metricTime(ev.totalMs || 0)}</span>`;
    row.title = `${ev.model || 'Modello'} · generazione ${metricTime(ev.generationMs || 0)}`;
  }
  function thinkingEl(ev) {
    let s = segs.get(ev.seg);
    if (!s) {
      const d = document.createElement('details');
      d.className = 'msg thinking';
      d.innerHTML = `<summary>${tag(ev)}Ragionamento</summary><div></div>`;
      s = { el: add(d), raw: '' };
      segs.set(ev.seg, s);
    }
    return s;
  }

  function argSummary(name, i = {}) {
    if (name === 'browser') return [i.action, i.url || i.text || (i.ref != null ? `[${i.ref}]` : '') || i.key || ''].filter(Boolean).join(' ');
    if (name === 'computer') return [i.action, i.x != null ? `(${i.x}, ${i.y})` : '', i.text || i.combo || ''].filter(Boolean).join(' ');
    if (name === 'todo_write') return `${i.items?.length || 0} voci`;
    if (name === 'submit_verdict') return `punteggio ${i.score} — ${i.done ? 'raggiunto' : 'non ancora'}`;
    return String(i.command || i.path || i.query || i.url || i.pattern || i.task || i.note || i.action || '').split('\n')[0];
  }
  function lightbox(src) {
    const d = div('lightbox', `<img src="${src}" alt="">`);
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  }
  function toolStart(ev) {
    const d = document.createElement('details');
    d.className = 'msg tool';
    d.innerHTML = `<summary><span class="ic">${icon(ev.name)}</span>${tag(ev)}<span class="tn">${esc(TOOL_SAY[ev.name] || ev.name)}</span>` +
      `<span class="ta">${esc(argSummary(ev.name, ev.input))}</span><span class="ts"><span class="spinner"></span></span></summary>` +
      `<div class="body"><div class="label">Richiesta</div><pre>${esc(JSON.stringify(ev.input, null, 2))}</pre></div>`;
    tools.set(ev.id, add(d));
  }
  function toolEnd(ev) {
    const d = tools.get(ev.id);
    if (!d) return;
    d.classList.add(ev.ok ? 'ok' : 'err');
    d.querySelector('.ts').textContent = ev.ms != null ? (ev.ms < 1000 ? `${ev.ms}ms` : `${(ev.ms / 1000).toFixed(1)}s`) : '';
    const body = d.querySelector('.body');
    body.insertAdjacentHTML('beforeend', `<div class="label">Risultato</div><pre>${esc(ev.output || '(vuoto)')}</pre>`);
    for (const src of ev.images || []) {
      const img = new Image(); img.src = src; img.className = 'shot'; img.loading = 'lazy'; img.onclick = () => lightbox(src); body.appendChild(img);
      if (!d.querySelector('.thumb')) {
        const th = new Image(); th.src = src; th.className = 'thumb'; th.loading = 'lazy';
        th.onclick = (e) => { e.preventDefault(); lightbox(src); };
        d.appendChild(th);
      }
    }
    if (ev.imagesDropped) body.insertAdjacentHTML('beforeend', `<div class="label">${ev.imagesDropped} immagine/i non salvate nello storico</div>`);
  }

  /* ───────── storico conversazioni ───────── */
  const when = (ts) => {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'ieri';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  };
  const dayGroup = (ts) => {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Oggi';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Ieri';
    if (now - ts < 7 * 864e5) return 'Ultimi 7 giorni';
    return 'Precedenti';
  };
  // Progetti: le conversazioni raggruppate per cartella di lavoro. Il progetto attivo è sempre aperto e in cima.
  const openProjects = new Set((() => { try { return JSON.parse(localStorage.getItem('howl-proj-open') || '[]'); } catch { return []; } })());
  const saveOpen = () => { try { localStorage.setItem('howl-proj-open', JSON.stringify([...openProjects])); } catch {} };
  const pkey = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase(); // stesso percorso, scritto in modi diversi
  const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).at(-1) || p;
  function chatRow(s) {
    return `<div class="chat-item ${s.id === currentId ? 'on' : ''}" data-id="${esc(s.id)}" title="${esc(s.title)}">
        <span class="t">${esc(s.title)}</span>
        <span class="when">${when(s.updatedAt)}</span>
        <span class="row-acts"><button data-ren="${esc(s.id)}" title="Rinomina">${svg('edit')}</button><button data-del="${esc(s.id)}" title="Elimina">${svg('trash')}</button></span>
      </div>`;
  }
  function renderChats() {
    const box = $('chats');
    const cur = pkey(config.workspace);
    const groups = new Map([[cur, []]]);
    const label = new Map([[cur, config.workspace || '']]);
    for (const s of sessions) {
      const k = pkey(s.workspace);
      if (!label.has(k)) label.set(k, s.workspace || '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const order = [...groups.keys()].sort((a, b) => (a === cur ? -1 : b === cur ? 1 : a === '' ? 1 : b === '' ? -1 : (groups.get(b)[0]?.updatedAt || 0) - (groups.get(a)[0]?.updatedAt || 0)));
    let html = '';
    for (const k of order) {
      const list = groups.get(k);
      if (!list.length && k !== cur) continue;
      const isCur = k === cur, open = isCur || openProjects.has(k);
      const dir = label.get(k);
      html += `<div class="proj-h ${isCur ? 'on' : ''} ${open ? 'open' : ''}" data-proj="${esc(k)}" title="${esc(dir || 'Conversazioni senza progetto (automazioni, telefono, chat vecchie)')}">
        <svg class="caret" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
        <span class="pn">${k ? `${svg('folder')} ${esc(baseName(dir))}` : 'Altre conversazioni'}</span>
        <small>${list.length}</small>
        ${k ? `<button data-proj-new="${esc(dir)}" title="Nuova chat in questo progetto" aria-label="Nuova chat">＋</button><button class="proj-delete" data-proj-delete="${esc(dir)}" title="Elimina progetto dalla barra laterale" aria-label="Elimina progetto">${svg('trash')}</button>` : '<span></span>'}
      </div>`;
      if (open) html += `<div class="proj-chats">${list.length ? list.map(chatRow).join('') : '<div class="chats-empty">Ancora nessuna conversazione in questo progetto.</div>'}</div>`;
    }
    box.innerHTML = html;
  }
  $('chats').addEventListener('click', (e) => {
    const pn = e.target.closest('[data-proj-new]');
    if (pn) { e.stopPropagation(); return startInProject(pn.dataset.projNew); }
    const pd = e.target.closest('[data-proj-delete]');
    if (pd) {
      e.stopPropagation();
      const dir = pd.dataset.projDelete;
      const active = pkey(dir) === pkey(config.workspace);
      const message = active
        ? 'Eliminare tutte le conversazioni di questo progetto? La cartella e i suoi file non verranno cancellati. Il progetto resta visibile perché è quello attivo.'
        : 'Eliminare questo progetto dalla barra laterale e tutte le sue conversazioni? La cartella e i suoi file non verranno cancellati.';
      if (confirm(message)) {
        openProjects.delete(pkey(dir)); saveOpen();
        post('/api/chat/delete-project', { workspace: dir });
      }
      return;
    }
    const ph = e.target.closest('.proj-h');
    if (ph) {
      const k = ph.dataset.proj;
      if (k === pkey(config.workspace)) return;
      if (openProjects.has(k)) openProjects.delete(k); else openProjects.add(k);
      saveOpen(); renderChats();
      return;
    }
    const ren = e.target.closest('[data-ren]'), del = e.target.closest('[data-del]');
    if (ren) { e.stopPropagation(); return startRename(ren.dataset.ren); }
    if (del) {
      e.stopPropagation();
      if (confirm('Eliminare questa conversazione?')) post('/api/chat/delete', { id: del.dataset.del });
      return;
    }
    const item = e.target.closest('.chat-item');
    if (item && item.dataset.id !== currentId) post('/api/chat/open', { id: item.dataset.id });
  });
  function startRename(id) {
    const item = $('chats').querySelector(`.chat-item[data-id="${id}"] .t`);
    if (!item) return;
    const old = item.textContent;
    item.contentEditable = 'true';
    item.focus();
    document.execCommand?.('selectAll', false, null);
    const done = (save) => {
      item.contentEditable = 'false';
      const t = item.textContent.trim();
      if (save && t && t !== old) post('/api/chat/rename', { id, title: t });
      else item.textContent = old;
    };
    item.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
    item.onblur = () => done(true);
  }

  /* ───────── pannelli ───────── */
  function renderTodos(items = []) {
    $('todoPanel').hidden = !items.length;
    $('todoCount').textContent = `${items.filter((t) => t.status === 'done').length}/${items.length}`;
    $('todos').innerHTML = items.map((t) => `<li class="${esc(t.status)}">${esc(t.text)}</li>`).join('');
  }
  const GOAL_LABEL = { planning: 'pianifica', working: 'al lavoro', verifying: 'verifica', achieved: 'raggiunto', exhausted: 'giri finiti', stalled: 'fermo', stopped: 'interrotto', failed: 'fallito' };
  function renderGoal(g) {
    if (!g) { $('goalPanel').hidden = true; return; }
    $('goalPanel').hidden = false;
    $('goalObjective').textContent = g.objective;
    $('goalStatus').textContent = GOAL_LABEL[g.status] || g.status;
    $('goalStatus').dataset.s = g.status;
    const score = g.history?.at(-1)?.score ?? 0;
    $('goalScore').textContent = score;
    $('goalBar').style.width = `${score}%`;
    $('goalIter').textContent = `${g.iteration}/${g.max}`;
    const vc = g.lastVerdict?.criteria || [];
    $('goalCriteria').innerHTML = (g.criteria || []).map((c, i) => `<li class="${vc[i] ? (vc[i].met ? 'met' : 'unmet') : ''}" title="${esc(vc[i]?.evidence || '')}">${esc(c)}</li>`).join('');
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
  function renderContext(c = { tokens: 0, limit: 0 }) {
    const pct = c.limit ? Math.min(100, Math.round((c.tokens / c.limit) * 100)) : 0;
    $('ctxText').textContent = `${pct}%`;
    $('ctxBar').style.width = `${pct}%`;
    $('ctxTokens').textContent = `${fmt(c.tokens)} / ${fmt(c.limit)} token`;
    const m = $('ctxMeter');
    m.classList.toggle('warn', pct >= 70 && pct < 90);
    m.classList.toggle('hot', pct >= 90);
    m.title = pct >= 70
      ? 'La finestra di contesto si sta riempiendo: Howl riassumerà la conversazione per liberare spazio.'
      : 'Spazio occupato nella finestra di contesto del modello.';
  }
  const setUsage = (u) => { $('usageTotal').textContent = `${fmt(u.input + u.output)} token usati`; };
  function renderConfig(c) {
    const previousWorkspace = config.workspace;
    config = c;
    $('brainName').textContent = c.brain ? c.brain.name : `${c.provider} · ${c.model}`;
    if (c.workspace) {
      if (c.workspace !== previousWorkspace) queueMicrotask(renderChats);
      const parts = c.workspace.split(/[\\/]/).filter(Boolean);
      $('wsName').textContent = parts.at(-1) || c.workspace;
      $('wsBtn').title = `Cartella di lavoro: ${c.workspace}${c.sandbox ? '\nProtetta: Howl crea e modifica file solo qui dentro' : ''}`;
      $('wsLock').hidden = !c.sandbox;
    }
    $('wsPath').textContent = c.workspace;
    $('toolCount').textContent = `${c.tools.length} strumenti collegati`;
    const mode = MODES.find((m) => m[0] === c.mode) || MODES[1];
    $('modeLabel').textContent = mode[1];
    $('modeIcon').innerHTML = svg(mode[3]);
    $('modeMenu').innerHTML = MODES.map(([id, label, descr, ic]) =>
      `<button data-mode="${id}" class="${id === c.mode ? 'on' : ''}">${svg(ic)}<span><b>${label}</b><small>${descr}</small></span>${id === c.mode ? '<span class="check">✓</span>' : ''}</button>`).join('');
    const think = c.think !== false;
    $('thinkBtn').classList.toggle('on', think);
    $('thinkBtn').title = think
      ? 'Ragionamento acceso: il modello pensa prima di rispondere — clic per spegnerlo'
      : 'Ragionamento spento: risposte dirette e più veloci — clic per accenderlo';
    if (!$('brains').hidden) renderBrainList();
  }
  function setBusy(b) {
    document.body.classList.toggle('busy', b);
    $('stopBtn').hidden = !b;
    $('hint').textContent = b ? 'Howl sta lavorando… premi Esc o il quadrato per fermarlo' : 'Invio per inviare · Shift+Invio per andare a capo';
  }

  /* ───────── permessi ───────── */
  function showApproval() {
    const ev = approvalQueue[0];
    if (!ev) { $('approval').hidden = true; return; }
    $('apAgent').textContent = ev.agent && ev.agent !== 'main' ? `Richiesta da: ${ev.agent}` : 'Controlla l\'azione prima di consentirla.';
    $('apTool').textContent = `${TOOL_SAY[ev.name] || ev.name} · ${argSummary(ev.name, ev.input)}`;
    $('apDanger').hidden = !ev.danger;
    $('apAlways').hidden = !!ev.danger;
    $('apInput').textContent = JSON.stringify(ev.input, null, 2);
    $('approval').hidden = false;
    $('apAllow').focus();
  }
  function answer(allow, always = false) {
    const ev = approvalQueue.shift();
    if (ev) post('/api/approve', { id: ev.id, allow, always });
    showApproval();
  }
  $('apAllow').onclick = () => answer(true);
  $('apAlways').onclick = () => answer(true, true);
  $('apDeny').onclick = () => answer(false);

  let userAction = null;
  function showUserAction(ev) {
    userAction = ev;
    if (!ev) { $('userAction').hidden = true; return; }
    $('uaTitle').textContent = ev.title;
    $('uaMessage').textContent = ev.message;
    $('uaUrl').textContent = ev.url || '';
    $('userAction').hidden = false;
  }
  const answerUserAction = (outcome) => { if (userAction) post('/api/useraction', { id: userAction.id, outcome }); showUserAction(null); };
  $('uaDone').onclick = () => answerUserAction('done');
  $('uaCancel').onclick = () => answerUserAction('cancel');

  /* ───────── eventi ───────── */
  function handle(ev) {
    switch (ev.type) {
      case 'snapshot': {
        replaying = true;
        feed.innerHTML = '';
        segs.clear(); tools.clear();
        commands = ev.commands;
        sessions = ev.sessions || [];
        currentId = ev.session?.id || null;
        $('chatTitle').textContent = ev.session?.title || '';
        renderChats();
        renderConfig(ev.config);
        const pending = new Map();
        let ua = null;
        for (const e of ev.log) {
          if (e.type === 'approval_request') pending.set(e.id, e);
          if (e.type === 'approval_resolved') pending.delete(e.id);
          if (e.type === 'user_action_request') ua = e;
          if (e.type === 'user_action_resolved') ua = null;
          if (!['state', 'approval_request', 'approval_resolved', 'user_action_request', 'user_action_resolved', 'busy', 'config', 'sessions'].includes(e.type)) handle(e);
        }
        renderTodos(ev.todos);
        renderGoal(ev.goal);
        tasks = ev.tasks || []; taskRunning = ev.taskRunning || null; renderTasks();
        remote = ev.remote || null; renderRemote();
        setUsage(ev.usage);
        renderContext(ev.context);
        setBusy(ev.busy);
        replaying = false;
        if (!ev.log.some((e) => ['user', 'assistant_text', 'tool_start'].includes(e.type))) { feed.innerHTML = ''; feed.appendChild(welcomeNode); }
        feed.scrollTop = feed.scrollHeight;
        approvalQueue = [...pending.values()];
        showApproval();
        showUserAction(ev.busy ? ua : null);
        wolf(approvalQueue.length ? 'approval' : ua && ev.busy ? 'waiting' : ev.busy ? 'thinking' : 'idle');
        return;
      }
      case 'sessions': sessions = ev.sessions; currentId = ev.current; renderChats(); {
        const cur = sessions.find((s) => s.id === currentId);
        if (cur) $('chatTitle').textContent = cur.title;
        break;
      }
      case 'user': {
        const node = add(div('msg user'));
        node.append(document.createTextNode(ev.text || 'Immagine allegata'));
        if (ev.images?.length) {
          const images = document.createElement('div'); images.className = 'user-images';
          for (const im of ev.images) { const img = new Image(); img.src = `data:${im.mediaType};base64,${im.data}`; img.alt = 'Immagine allegata'; img.onclick = () => lightbox(img.src); images.appendChild(img); }
          node.appendChild(images);
        }
        break;
      }
      case 'text_delta': {
        const s = assistantEl(ev);
        s.raw += ev.text;
        s.el.classList.add('live');
        if (!s.pending) { s.pending = true; requestAnimationFrame(() => { s.pending = false; renderSeg(s); if (nearBottom()) feed.scrollTop = feed.scrollHeight; }); }
        break;
      }
      case 'assistant_text': { const s = assistantEl(ev); s.raw = ev.text; s.el.classList.remove('live'); renderSeg(s); break; }
      case 'response_metrics': renderResponseMetrics(ev); break;
      case 'thinking_delta': { const s = thinkingEl(ev); s.raw += ev.text; s.el.lastElementChild.textContent = s.raw; break; }
      case 'thinking': { const s = thinkingEl(ev); s.raw = ev.text; s.el.lastElementChild.textContent = s.raw; break; }
      case 'tool_start': toolStart(ev); wolf('tool', TOOL_SAY[ev.name] || ev.name, { tool: ev.name }); break;
      case 'tool_end': toolEnd(ev); break;
      case 'info': add(div('msg line', md(ev.text))); break;
      case 'error': add(div('msg line err', md(ev.text))); wolf('error'); break;
      case 'state':
        if (ev.state === 'thinking') wolf('thinking', ev.agent === 'verifier' ? 'Verifica il lavoro svolto' : undefined);
        else if (ev.state === 'streaming') wolf('streaming');
        else if (ev.state === 'approval') wolf('approval');
        else if (ev.state === 'success') wolf('success');
        else if (ev.state === 'idle') wolf('idle');
        break;
      case 'approval_request': approvalQueue.push(ev); showApproval(); break;
      case 'approval_resolved': approvalQueue = approvalQueue.filter((a) => a.id !== ev.id); showApproval(); break;
      case 'user_action_request':
        showUserAction(ev);
        add(div('msg line', md(`⏸ **${ev.title}** — ${ev.message}`)));
        wolf('waiting');
        break;
      case 'user_action_resolved':
        if (userAction?.id === ev.id) showUserAction(null);
        add(div('msg line', ev.outcome === 'done' ? '▶ Verifica completata, riprendo.' : '⏹ Verifica non completata.'));
        break;
      case 'todo': renderTodos(ev.items); break;
      case 'goal': renderGoal(ev.goal); break;
      case 'goal_phase':
        add(div(`msg goal-banner ${ev.phase}`, `<span>${inline(ev.text)}</span>`));
        if (ev.phase === 'achieved') wolf('goal', 'Obiettivo raggiunto');
        break;
      case 'goal_verdict':
        add(div(`msg verdict ${ev.done ? 'done' : ''}`,
          `<div class="vh">Verifica · giro ${ev.iteration} <span class="bar"><i style="width:${ev.score}%"></i></span> ${ev.score}/100</div>` +
          `<div>${inline(ev.feedback || '')}</div>` +
          (ev.missing?.length ? `<ul>${ev.missing.map((m) => `<li>${inline(m)}</li>`).join('')}</ul>` : '')));
        break;
      case 'tasks': tasks = ev.tasks; taskRunning = ev.running || null; renderTasks(); break;
      case 'task_started':
        taskRunning = ev.taskId; taskTool = null; renderTasks();
        add(div('msg line', md(`🕗 Automazione **${ev.name}** avviata${ev.trigger === 'manual' ? ' a mano' : ''}…`)));
        break;
      case 'task_progress': taskTool = ev.tool ? (TOOL_SAY[ev.tool] || ev.tool) : null; renderTasks(); break;
      case 'task_done':
        taskRunning = null; taskTool = null; renderTasks();
        add(div(`msg task-done ${ev.ok ? '' : 'bad'}`,
          `<div class="th">${svg('clock')} ${esc(ev.name)} — ${ev.ok ? 'fatto' : 'non riuscita'}${ev.ms ? ` · ${Math.round(ev.ms / 1000)}s` : ''}` +
          (ev.sessionId ? `<button class="link" data-open-session="${esc(ev.sessionId)}">apri la conversazione</button>` : '') + '</div>' +
          `<div>${md(ev.report || '')}</div>`));
        break;
      case 'remote': remote = ev.remote; renderRemote(); break;
      case 'remote_activity':
        if (ev.phase === 'start') add(div('msg line', md(`📱 Richiesta da **${ev.channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}**: ${ev.text || ''}`)));
        if (ev.phase === 'start') wolf('listening', 'Ascolta una richiesta dal telefono');
        if (ev.phase === 'tool' && remote?.[ev.channel]?.running) { remote[ev.channel].running.tool = ev.tool; renderRemote(); }
        if (ev.phase === 'tool') wolf('tool', TOOL_SAY[ev.tool] || ev.tool, { tool: ev.tool });
        if (ev.phase === 'done') wolf('success', 'Richiesta dal telefono completata');
        break;
      case 'remote_pair_request': showPairAsk(ev); break;
      case 'branco':
        if (!$('branco').hidden) {
          if (ev.line) { const l = $('bcLog'); l.hidden = false; l.textContent += `${ev.line}\n`; l.scrollTop = l.scrollHeight; }
          if (ev.fine || /→|— Generazione/.test(ev.line || '')) refreshBranco();
        }
        if (ev.fine) add(div('msg line', md(`🐺 Corsa del branco terminata${ev.code ? ' (interrotta)' : ''}. Apri **Impostazioni → Laboratorio del branco** per il grafo.`)));
        break;
      case 'wiki_progress':
        if (!$('wiki').hidden) { $('wikiStatus').hidden = false; const label=ev.phase==='raw'?'Salvo in raw':ev.phase==='extract'?'Estraggo il testo':'Il cervello compila'; $('wikiStatus').innerHTML = `<span class="spinner"></span> ${label} <b>${esc(ev.name || 'la fonte')}</b> · ${ev.current}/${ev.total}${ev.parts ? ` · parte ${ev.part}/${ev.parts}` : ''}`; }
        break;
      case 'remote_alert': if (!ev.quiet) add(div('msg line err', md(ev.text))); break;
      case 'usage': setUsage(ev.usage); break;
      case 'context': renderContext(ev.context); break;
      case 'busy': setBusy(ev.busy); break;
      case 'config': renderConfig(ev.config); break;
      case 'clear':
        feed.innerHTML = '';
        segs.clear(); tools.clear();
        renderTodos([]); renderGoal(null); renderContext({ tokens: 0, limit: config.contextLimit || 0 });
        feed.appendChild(welcomeNode);
        wolf('idle');
        break;
    }
  }

  const connect = () => {
    eventSource?.close();
    const es = eventSource = new EventSource(`/api/events?t=${TOKEN}`);
    es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
    es.onerror = () => setTimeout(async () => {
      if (eventSource !== es) return;
      try {
        const html = await fetch(`/?token_probe=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
        const fresh = html.match(/name="howl-token" content="([^"]+)"/)?.[1];
        if (fresh && fresh !== TOKEN) { TOKEN = fresh; document.querySelector('meta[name=howl-token]').content = fresh; connect(); }
      } catch {}
    }, 500);
  };

  /* ───────── composer ───────── */
  let attachments = [];
  const renderAttachments = () => {
    const tray = $('attachmentTray');
    tray.hidden = !attachments.length;
    tray.innerHTML = attachments.map((a, i) => `<div class="attachment"><img src="data:${a.mediaType};base64,${a.data}" alt="Immagine allegata"><button type="button" data-remove-image="${i}" title="Rimuovi">×</button></div>`).join('');
  };
  const addImages = async (files) => {
    for (const file of [...files]) {
      if (attachments.length >= 3) break;
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) continue;
      if (file.size > 3 * 1024 * 1024) { alert(`"${file.name}" è troppo grande. Scegli un'immagine sotto i 3 MB.`); continue; }
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (m) attachments.push({ mediaType: m[1], data: m[2] });
    }
    renderAttachments();
  };
  $('attachBtn').onclick = () => $('imageInput').click();
  $('imageInput').onchange = (e) => { addImages(e.target.files); e.target.value = ''; };
  $('attachmentTray').onclick = (e) => { const b = e.target.closest('[data-remove-image]'); if (b) { attachments.splice(+b.dataset.removeImage, 1); renderAttachments(); } };
  input.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(files); } });
  $('composer').addEventListener('dragover', (e) => e.preventDefault());
  $('composer').addEventListener('drop', (e) => { const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); addImages(files); } });
  function send(text) {
    text = text.trim();
    if (!text && !attachments.length) return;
    post('/api/message', { text, images: attachments });
    attachments = []; renderAttachments();
    input.value = '';
    autosize();
    hideSuggest();
  }
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 210) + 'px'; };
  const stop = () => post('/api/stop');

  let sugIndex = 0, sugItems = [];
  const hideSuggest = () => { $('suggest').hidden = true; sugItems = []; };
  function updateSuggest() {
    const v = input.value;
    if (!v.startsWith('/') || v.includes('\n')) return hideSuggest();
    const q = v.toLowerCase().split(' ')[0];
    sugItems = commands.filter(([c]) => c.toLowerCase().startsWith(q) || c.toLowerCase().includes(q));
    if (!sugItems.length || (sugItems.length === 1 && v.length > sugItems[0][0].split(' ')[0].length)) return hideSuggest();
    sugIndex = Math.min(sugIndex, sugItems.length - 1);
    $('suggest').innerHTML = sugItems.map(([c, d], i) => `<div class="${i === sugIndex ? 'sel' : ''}" data-i="${i}"><code>${esc(c)}</code><span>${esc(d)}</span></div>`).join('');
    $('suggest').hidden = false;
  }
  function applySuggest(i) {
    input.value = sugItems[i][0].split(' ')[0] + ' ';
    hideSuggest();
    input.focus();
  }
  $('suggest').addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); applySuggest(+d.dataset.i); } });
  input.addEventListener('input', () => { autosize(); sugIndex = 0; updateSuggest(); listenWhileTyping(); });
  let typingTimer = null;
  // mentre scrivi, Howl (se è libero) si mette in ascolto
  function listenWhileTyping() {
    if (document.body.classList.contains('busy')) return;
    howl.listen(!!input.value.trim());
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => howl.listen(false), 4000);
  }
  input.addEventListener('keydown', (e) => {
    if (!$('suggest').hidden && sugItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length; updateSuggest(); return; }
      if (e.key === 'Tab') { e.preventDefault(); applySuggest(sugIndex); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  $('stopBtn').onclick = stop;

  addEventListener('keydown', (e) => {
    if (!$('approval').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); answer(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answer(true); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); post('/api/chat/new'); return; }
    if (e.key !== 'Escape') return;
    if (!$('brains').hidden) { $('brains').hidden = true; return; }
    if (!$('tasks').hidden) { $('tasks').hidden = true; return; }
    if (!$('bcGraph').hidden) { closeGraph(); return; }
    if (!$('branco').hidden) { $('branco').hidden = true; return; }
    if (!$('phone').hidden) { $('phone').hidden = true; return; }
    if (closeMenus()) return;
    if (!$('suggest').hidden) { hideSuggest(); return; }
    if (document.body.classList.contains('busy')) { e.preventDefault(); stop(); }
  });

  feed.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (b) { input.value = b.dataset.ex; autosize(); input.focus(); return; }
    const s = e.target.closest('[data-open-session]');
    if (s) post('/api/chat/open', { id: s.dataset.openSession });
  });
  $('newChat').onclick = () => post('/api/chat/new');

  // titolo della conversazione: doppio clic per rinominare
  $('chatTitle').addEventListener('dblclick', () => {
    const el = $('chatTitle');
    const old = el.textContent;
    el.contentEditable = 'true';
    el.focus();
    const done = (save) => {
      el.contentEditable = 'false';
      const t = el.textContent.trim();
      if (save && t && t !== old) post('/api/chat/rename', { id: currentId, title: t });
      else el.textContent = old;
    };
    el.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } if (ev.key === 'Escape') done(false); };
    el.onblur = () => done(true);
  });

  /* ───────── tendine ───────── */
  function closeMenus() {
    let closed = false;
    for (const dd of document.querySelectorAll('.dd.open')) { dd.classList.remove('open'); dd.querySelector('.dd-menu')?.setAttribute('hidden', ''); closed = true; }
    return closed;
  }
  function toggleMenu(ddId, menuId) {
    const dd = $(ddId), menu = $(menuId), open = dd.classList.contains('open');
    closeMenus();
    if (!open) { dd.classList.add('open'); menu.hidden = false; }
  }
  $('modeBtn').onclick = (e) => { e.stopPropagation(); toggleMenu('modeDd', 'modeMenu'); };
  $('wsBtn').onclick = (e) => { e.stopPropagation(); renderWsMenu(); toggleMenu('wsDd', 'wsMenu'); };
  $('moreBtn').onclick = (e) => { e.stopPropagation(); toggleMenu('moreDd', 'moreMenu'); };
  $('modeMenu').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) { send(`/mode ${b.dataset.mode}`); closeMenus(); } };
  $('thinkBtn').onclick = () => send('/think');
  $('moreMenu').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMenus();
    const act = b.dataset.act;
    if (act === 'tasks') openTasks();
    if (act === 'phone') openPhone();
    if (act === 'branco') openBranco();
    if (act === 'update') { if (upd.status === 'ready') desk.installUpdate(); else desk.checkUpdate(); }
    if (act === 'cwd') pickWorkspace();
    if (act === 'compact') send('/compact');
    if (act === 'memory') send('/memory');
    if (act === 'tools') send('/tools');
    if (act === 'help') send('/help');
  };
  document.querySelector('.feature-dock').onclick = (e) => {
    const b = e.target.closest('[data-feature]'); if (!b) return;
    const act = b.dataset.feature;
    if (act === 'wiki') openWiki();
    if (act === 'branco') openBranco();
    if (act === 'tasks') openTasks();
    if (act === 'phone') openPhone();
    if (act === 'memory') send('/memory');
  };
  addEventListener('click', (e) => { if (!e.target.closest('.dd')) closeMenus(); });

  /* ───────── Howl sul desktop ───────── */
  if (desk) {
    const pin = $('mascotToggle');
    pin.hidden = false;
    const paint = (on) => { pin.classList.toggle('on', !!on); pin.title = on ? 'Nascondi Howl dal desktop (Ctrl+Shift+M)' : 'Mostra Howl sul desktop (Ctrl+Shift+M)'; };
    desk.getMascot().then(paint);
    desk.onMascot(paint);
    pin.onclick = () => { const next = !pin.classList.contains('on'); paint(next); desk.setMascot(next); };
  }

  /* ───────── aggiornamenti dell'app desktop ───────── */
  // L'app scarica da sola le versioni nuove; qui c'è solo il pulsante per installarle subito.
  let upd = { status: 'dev' };
  function renderUpdate(u) {
    upd = u || upd;
    const btn = $('updBtn'), item = $('updItem');
    const packaged = upd.status !== 'dev';
    item.hidden = !packaged;
    btn.hidden = !['downloading', 'ready'].includes(upd.status);
    btn.className = `upd-btn nodrag ${upd.status === 'ready' ? 'ready' : ''}`;
    btn.disabled = upd.status !== 'ready';
    if (upd.status === 'ready') btn.innerHTML = `${svg('bolt')} Aggiorna ora alla ${esc(upd.version)}`;
    else if (upd.status === 'downloading') btn.innerHTML = `Scarico la ${esc(upd.version || 'nuova versione')} <span class="upd-bar"><i style="width:${upd.percent || 0}%"></i></span>`;
    btn.title = upd.status === 'ready' ? "L'app si chiude, si aggiorna e si riapre da sola (pochi secondi)" : '';
    const sub = {
      idle: `Versione ${upd.current} · cerca aggiornamenti`,
      checking: 'Controllo in corso…',
      downloading: `Scarico la ${upd.version}… ${upd.percent || 0}%`,
      ready: `La ${upd.version} è pronta: clic per installarla`,
      latest: `Hai già l'ultima versione (${upd.current})`,
      error: 'Controllo non riuscito: riprova più tardi',
    }[upd.status] || '';
    $('updItemTitle').textContent = upd.status === 'ready' ? 'Aggiorna ora' : 'Aggiornamenti';
    $('updItemSub').textContent = sub;
  }
  if (desk?.getUpdate) {
    desk.getUpdate().then(renderUpdate);
    desk.onUpdate(renderUpdate);
    $('updBtn').onclick = () => { if (upd.status === 'ready') { $('updBtn').textContent = 'Aggiorno…'; desk.installUpdate(); } };
  }

  /* ───────── modelli ───────── */
  const brainApi = (action, body) => post(`/api/brains/${action}`, body).then((r) => r.json());
  const form = $('brForm');
  let editingId = null;
  const PRESET_FORMS = [
    ['LM Studio', { kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', contextLimit: 32000, maxTokens: 4096 }],
    ['Ollama', { kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', contextLimit: 32000, maxTokens: 4096 }],
    ['Qwen cloud', { kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3.5-plus', contextLimit: 128000, maxTokens: 8192, vision: true }],
    ['OpenRouter', { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', contextLimit: 128000, maxTokens: 8192 }],
    ['DeepSeek', { kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', contextLimit: 128000, maxTokens: 8192 }],
    ['Claude', { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5', contextLimit: 180000, maxTokens: 16000, vision: true }],
  ];
  const readForm = () => {
    const f = new FormData(form);
    return {
      id: editingId, name: f.get('name'), kind: f.get('kind'), baseUrl: f.get('baseUrl'), apiKey: f.get('apiKey'), model: f.get('model'),
      contextLimit: +f.get('contextLimit'), maxTokens: +f.get('maxTokens'), vision: f.get('vision') === 'on', echoReasoning: f.get('echoReasoning') === 'on',
    };
  };
  const fillForm = (b = {}) => {
    for (const el of form.elements) {
      if (!el.name || b[el.name] === undefined) continue;
      if (el.type === 'checkbox') el.checked = !!b[el.name]; else el.value = b[el.name];
    }
  };
  function openForm(b) {
    editingId = b?.id || null;
    form.reset();
    fillForm(b || {});
    $('brFormTitle').textContent = b?.id ? `Modifica · ${b.name}` : 'Nuovo modello';
    $('brPresets').hidden = !!b?.id;
    $('brTestOut').hidden = true;
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('brPresets').innerHTML = PRESET_FORMS.map(([n], i) => `<button type="button" data-p="${i}">${esc(n)}</button>`).join('');
  $('brPresets').onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const [name, p] = PRESET_FORMS[+b.dataset.p];
    fillForm({ name, ...p });
    if (p.baseUrl.includes('127.0.0.1')) $('brLoad').click();
  };
  function renderBrainList() {
    const list = config.brains || [];
    $('brList').innerHTML = list.length ? list.map((b) => {
      const on = config.brain?.id === b.id;
      return `<div class="br-item ${on ? 'active' : ''}"><div><div class="n">${esc(b.name)}${on ? '<span class="badge-on">● in uso</span>' : ''}</div>
        <div class="m">${esc(b.model)} · ${esc(b.baseUrl)}</div></div>
        <div class="acts">${on ? '' : `<button class="use" data-use="${esc(b.id)}">Usa</button>`}<button data-edit="${esc(b.id)}">Modifica</button><button data-del="${esc(b.id)}" title="Elimina">✕</button></div></div>`;
    }).join('') : '<span class="muted">Nessun modello salvato: usa uno di quelli rilevati o aggiungine uno.</span>';
  }
  $('brList').onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.use) {
      t.disabled = true;
      const label = t.textContent;
      t.textContent = 'Attivo…';
      const r = await brainApi('activate', { id: t.dataset.use });
      if (r.error) { t.disabled = false; t.textContent = label; return alert(r.error); }
      $('brains').hidden = true;
    }
    if (t.dataset.edit) openForm(config.brains.find((b) => b.id === t.dataset.edit));
    if (t.dataset.del && confirm('Eliminare questo modello?')) {
      const r = await brainApi('delete', { id: t.dataset.del });
      if (r.error) alert(r.error);
    }
  };
  async function scan() {
    $('brDetected').innerHTML = '<span class="muted">Cerco modelli sul tuo computer…</span>';
    const { servers = [] } = await brainApi('detect', {});
    const items = servers.flatMap((s) => s.models.map((m) => ({ s, m })));
    $('brDetected').innerHTML = items.length
      ? items.map(({ s, m }, i) => `<span class="det"><small>${esc(s.name)}</small><b>${esc(m)}</b><button data-det="${i}">Usa</button></span>`).join('')
      : '<span class="muted">Nessun server locale attivo. In LM Studio avvia il server dalla scheda Developer.</span>';
    $('brDetected').onclick = async (e) => {
      const b = e.target.closest('[data-det]');
      if (!b) return;
      const { s, m } = items[+b.dataset.det];
      const existing = (config.brains || []).find((x) => x.baseUrl === s.baseUrl && x.model === m);
      b.textContent = '…';
      const r = existing
        ? await brainApi('activate', { id: existing.id })
        : await brainApi('save', { activate: true, brain: { name: `${m.split('/').pop()} (${s.name})`, kind: 'openai', baseUrl: s.baseUrl, model: m, contextLimit: 32000, maxTokens: 4096 } });
      if (r.error) { b.textContent = 'Usa'; return alert(r.error); }
      $('brains').hidden = true;
    };
  }
  $('brainBtn').onclick = () => { $('brains').hidden = false; renderBrainList(); form.hidden = true; scan(); };
  $('brClose').onclick = () => { $('brains').hidden = true; };
  $('brCancel').onclick = () => { form.hidden = true; };
  $('brNew').onclick = () => openForm(null);
  $('brRescan').onclick = scan;
  $('brains').addEventListener('mousedown', (e) => { if (e.target.id === 'brains') $('brains').hidden = true; });
  const showTest = (text, cls = '') => { const o = $('brTestOut'); o.hidden = false; o.className = `test-out ${cls}`; o.textContent = text; };
  $('brLoad').onclick = async () => {
    const btn = $('brLoad');
    btn.textContent = '…';
    const r = await brainApi('models', readForm());
    btn.textContent = 'Carica elenco';
    if (r.error) return showTest(`Non riesco a leggere i modelli: ${r.error}`, 'bad');
    $('brModels').innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join('');
    if (!form.elements.model.value && r.models[0]) form.elements.model.value = r.models[0];
    showTest(`${r.models.length} modelli disponibili: ${r.models.slice(0, 8).join(', ')}${r.models.length > 8 ? '…' : ''}`);
  };
  $('brTest').onclick = async () => {
    showTest('Prova in corso: chiedo al modello di usare uno strumento…');
    const r = await brainApi('test', { brain: readForm() });
    if (r.error) return showTest(`Errore: ${r.error}`, 'bad');
    showTest(r.toolCalling
      ? `✓ Funziona. Risposta in ${(r.ms / 1000).toFixed(1)}s e usa gli strumenti correttamente: ${r.call}`
      : `Il modello risponde (${(r.ms / 1000).toFixed(1)}s) ma NON usa gli strumenti: come agente sarà molto limitato.\nRisposta: ${r.text || '(vuota)'}`, r.toolCalling ? 'ok' : 'bad');
  };
  async function save(activate) {
    if (!form.reportValidity()) return;
    const r = await brainApi('save', { brain: readForm(), activate });
    if (r.error) return showTest(r.error, 'bad');
    form.hidden = true;
    if (activate) $('brains').hidden = true;
  }
  form.onsubmit = (e) => { e.preventDefault(); save(false); };
  $('brSaveUse').onclick = () => save(true);

  /* ───────── automazioni ───────── */
  const taskApi = (action, body) => post(`/api/tasks/${action}`, body).then((r) => r.json());
  const DAYS_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

  // "tra 12 minuti", "oggi alle 08:00", "gio 25 set, 09:30"
  function untilText(ts) {
    if (!ts) return 'in pausa';
    const min = Math.round((ts - Date.now()) / 60000);
    if (min <= 0) return 'a momenti';
    if (min < 60) return `tra ${min} min`;
    const d = new Date(ts), now = new Date();
    const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `oggi alle ${hm}`;
    const dom = new Date(now); dom.setDate(now.getDate() + 1);
    if (d.toDateString() === dom.toDateString()) return `domani alle ${hm}`;
    return `${d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}, ${hm}`;
  }

  function renderTasks() {
    const panel = $('taskPanel');
    panel.hidden = !tasks.length;
    if (!tasks.length) { if (!$('tasks').hidden) renderTaskList(); return; }
    const run = tasks.find((t) => t.id === taskRunning);
    const next = tasks.filter((t) => t.enabled && t.nextRun).sort((a, b) => a.nextRun - b.nextRun)[0];
    const pill = $('taskPill');
    pill.textContent = run ? 'in corso' : `${tasks.filter((t) => t.enabled).length} attive`;
    pill.dataset.s = run ? 'run' : '';
    $('taskNext').innerHTML = run
      ? `<b>${esc(run.name)}</b><small>${esc(taskTool || 'ci sta lavorando…')}</small>`
      : next ? `<b>${esc(next.name)}</b><small>${esc(untilText(next.nextRun))}</small>`
        : '<small>Nessuna in programma</small>';
    if (!$('tasks').hidden) renderTaskList();
  }
  $('taskPanel').onclick = () => openTasks();

  function renderTaskList() {
    $('tkList').innerHTML = tasks.length ? tasks.map((t) => {
      const run = t.id === taskRunning;
      const last = t.lastRun ? `${t.lastStatus === 'ok' ? '✅' : '⚠️'} ultima ${untilLast(t.lastRun)}${t.lastReport ? ` — ${esc(t.lastReport.replace(/\s+/g, ' ').slice(0, 90))}` : ''}` : 'mai eseguita';
      return `<div class="tk-item ${t.enabled ? '' : 'off'} ${run ? 'run' : ''}">
        <div><div class="n">${esc(t.name)}</div>
        <div class="w">${esc(t.when)}${t.enabled && t.nextRun ? ` · ${esc(untilText(t.nextRun))}` : ' · in pausa'}${t.mode === 'readonly' ? ' · sola lettura' : ''}</div>
        <div class="last">${run ? '⏳ in esecuzione…' : last}</div></div>
        <div class="acts">
          <button data-run="${esc(t.id)}" ${run ? 'disabled' : ''}>Esegui</button>
          <button data-tog="${esc(t.id)}">${t.enabled ? 'Pausa' : 'Attiva'}</button>
          <button data-edit="${esc(t.id)}">Modifica</button>
          <button data-del="${esc(t.id)}" title="Elimina">✕</button>
        </div></div>`;
    }).join('') : '<span class="muted">Nessuna automazione. Creane una, oppure chiedila a Howl in chat: «ogni mattina alle 8 controlla le novità e scrivimi il riassunto».</span>';
  }
  const untilLast = (ts) => {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 60) return `${min} min fa`;
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? `oggi alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
      : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const tkForm = $('tkForm');
  function openTasks() { $('tasks').hidden = false; tkForm.hidden = true; renderTaskList(); taskApi('list', {}).then((r) => { if (r.tasks) { tasks = r.tasks; taskRunning = r.running; renderTasks(); } }); }
  $('tkClose').onclick = () => { $('tasks').hidden = true; };
  $('tkCancel').onclick = () => { tkForm.hidden = true; };
  $('tasks').addEventListener('mousedown', (e) => { if (e.target.id === 'tasks') $('tasks').hidden = true; });

  $('tkDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-day="${d}">${DAYS_SHORT[d]}</button>`).join('');
  $('tkDays').onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) b.classList.toggle('on'); };

  const TK_PRESETS = [
    ['Rassegna del mattino', { name: 'Rassegna del mattino', kind: 'daily', time: '08:00', prompt: 'Cerca sul web le notizie più importanti delle ultime 24 ore sull\'intelligenza artificiale, verifica le fonti e scrivi un riassunto di 5 punti con i link.' }],
    ['Riepilogo del lunedì', { name: 'Riepilogo della settimana', kind: 'weekly', days: [1], time: '09:00', prompt: 'Guarda i file modificati nella cartella di lavoro nell\'ultima settimana e scrivi un riepilogo di cosa è cambiato.' }],
    ['Controllo ogni ora', { name: 'Controllo', kind: 'interval', everyMin: 60, prompt: 'Controlla che il sito in produzione risponda e segnala se qualcosa non va.' }],
  ];
  $('tkPresets').innerHTML = TK_PRESETS.map(([label], i) => `<button type="button" data-tp="${i}">${label}</button>`).join('');
  $('tkPresets').onclick = (e) => { const b = e.target.closest('[data-tp]'); if (b) fillTaskForm(TK_PRESETS[+b.dataset.tp][1]); };

  function showFields() {
    const kind = tkForm.elements.kind.value;
    const show = { daily: ['time'], weekly: ['time', 'days'], interval: ['every'], once: ['at'] }[kind] || [];
    for (const el of tkForm.querySelectorAll('[data-f]')) el.hidden = !show.includes(el.dataset.f);
  }
  tkForm.elements.kind.onchange = showFields;

  let editingTask = null;
  function fillTaskForm(v = {}) {
    const f = tkForm.elements;
    if (v.name !== undefined) f.name.value = v.name;
    if (v.prompt !== undefined) f.prompt.value = v.prompt;
    f.kind.value = v.kind || 'daily';
    f.time.value = v.time || '08:00';
    f.everyMin.value = v.everyMin || 60;
    if (v.at) { const d = new Date(v.at); f.at.value = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
    f.mode.value = v.mode || 'auto';
    f.notify.checked = v.notify !== false;
    const days = v.days || [];
    for (const b of $('tkDays').children) b.classList.toggle('on', days.includes(+b.dataset.day));
    showFields();
  }
  function openTaskForm(task) {
    editingTask = task?.id || null;
    $('tkFormTitle').textContent = task ? 'Modifica automazione' : 'Nuova automazione';
    fillTaskForm(task ? { ...task, ...task.schedule } : { name: '', prompt: '', kind: 'daily', time: '08:00', days: [], mode: 'auto', notify: true });
    tkForm.hidden = false;
    tkForm.elements.name.focus();
  }
  $('tkNew').onclick = () => openTaskForm(null);

  $('tkList').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.edit) return openTaskForm(tasks.find((t) => t.id === d.edit));
    if (d.run) { b.textContent = '…'; const r = await taskApi('run', { id: d.run }); if (r.error) alert(r.error); return; }
    if (d.tog) {
      const t = tasks.find((x) => x.id === d.tog);
      const r = await taskApi('update', { id: d.tog, enabled: !t.enabled });
      if (r.tasks) { tasks = r.tasks; renderTasks(); }
      return;
    }
    if (d.del && confirm('Eliminare questa automazione?')) {
      const r = await taskApi('delete', { id: d.del });
      if (r.tasks) { tasks = r.tasks; renderTasks(); }
    }
  };

  tkForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!tkForm.reportValidity()) return;
    const f = tkForm.elements;
    const kind = f.kind.value;
    const schedule = { kind };
    if (kind === 'daily' || kind === 'weekly') schedule.time = f.time.value || '08:00';
    if (kind === 'weekly') schedule.days = [...$('tkDays').children].filter((b) => b.classList.contains('on')).map((b) => +b.dataset.day);
    if (kind === 'interval') schedule.everyMin = Math.max(1, +f.everyMin.value || 60);
    if (kind === 'once') {
      const at = Date.parse(f.at.value);
      if (!Number.isFinite(at)) return alert('Scegli data e ora.');
      schedule.at = at;
    }
    if (kind === 'weekly' && !schedule.days.length) return alert('Scegli almeno un giorno della settimana.');
    const body = { id: editingTask, name: f.name.value, prompt: f.prompt.value, mode: f.mode.value, notify: f.notify.checked, schedule };
    const r = await taskApi(editingTask ? 'update' : 'create', body);
    if (r.error) return alert(r.error);
    tasks = r.tasks; renderTasks();
    tkForm.hidden = true;
  };

  /* ───────── Howl dal telefono (Telegram / WhatsApp) ───────── */
  const remoteApi = async (action, body) => {
    const r = await post(`/api/remote/${action}`, body).then((x) => x.json()).catch((e) => ({ error: e.message }));
    if (r.remote) { remote = r.remote; renderRemote(); }
    if (r.error) alert(r.error);
    return r;
  };
  const CH = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
  const MODE_OPTS = [
    ['readonly', 'Solo leggere e cercare'],
    ['ask', 'Chiede conferma sul telefono (consigliato)'],
    ['auto', 'Autonomo — le azioni pericolose restano vietate'],
  ];
  const modeSelect = (ch, v) => `<select data-mode-ch="${ch}">${MODE_OPTS.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const pill = (el, text, s) => { el.textContent = text; el.dataset.s = s; };
  const mins = (ts) => Math.max(0, Math.ceil((ts - Date.now()) / 60000));

  function renderRemote() {
    const r = remote;
    // riquadro nella barra laterale
    const on = r && (r.telegram.enabled || r.whatsapp.enabled);
    $('phonePanel').hidden = !on;
    if (on) {
      const ch = ['telegram', 'whatsapp'].find((c) => r[c].running) || null;
      const unlocked = ['telegram', 'whatsapp'].filter((c) => r[c].enabled && r[c].unlocked);
      const locked = ['telegram', 'whatsapp'].some((c) => r[c].lockedOut);
      pill($('phonePill'), ch ? 'al lavoro' : locked ? 'bloccato' : unlocked.length ? 'sbloccato' : 'protetto', ch ? 'run' : locked ? 'bad' : unlocked.length ? 'on' : 'off');
      $('phoneNext').innerHTML = ch
        ? `<b>${CH[ch]}: ${esc(r[ch].running.text || '')}</b><small>${r[ch].awaitingApproval ? 'aspetta la tua conferma sul telefono' : esc(TOOL_SAY[r[ch].running.tool] || r[ch].running.tool || 'ci sta lavorando…')}</small><div><button class="btn sm stop-remote" data-remote-stop>Ferma</button></div>`
        : `<b>${['telegram', 'whatsapp'].filter((c) => r[c].enabled).map((c) => CH[c]).join(' · ')}</b><small>${locked ? '⛔ troppi PIN errati: riattiva dalle impostazioni' : unlocked.length ? `🔓 ${unlocked.map((c) => CH[c]).join(', ')} sbloccato` : '🔒 bloccato col PIN'}</small>`;
    }
    if ($('phone').hidden || !r) return;

    $('phSeal').textContent = r.sealKind === 'plain' ? 'NON cifrati su questo sistema (manca DPAPI)' : 'Cifrati con il tuo account Windows';
    pill($('phPinPill'), r.hasPin ? 'impostato' : 'da impostare', r.hasPin ? 'on' : 'bad');
    $('phPinBtn').textContent = r.hasPin ? 'Cambia PIN' : 'Salva PIN';
    if (document.activeElement !== $('phIdle')) $('phIdle').value = r.idleLockMin;
    const needPin = r.hasPin ? '' : '<div class="warn">Imposta prima il PIN qui sopra: senza PIN l\'accesso dal telefono non si attiva.</div>';

    // Telegram
    const tg = r.telegram;
    pill($('tgPill'), tg.lockedOut ? 'bloccato' : !tg.configured ? 'non collegato' : !tg.enabled ? 'spento' : tg.status === 'error' ? 'errore' : tg.owner ? 'attivo' : 'da abbinare',
      tg.lockedOut || tg.status === 'error' ? 'bad' : tg.enabled && tg.owner ? 'on' : 'off');
    let h = '';
    if (!tg.configured) {
      h = `${needPin}<ol>
          <li>Su Telegram apri <b>@BotFather</b> e scrivi <code>/newbot</code>: scegli un nome e un username (finisce con «bot»).</li>
          <li>Copia il <b>token</b> che ti dà e incollalo qui sotto. Il bot è tuo e di nessun altro.</li>
        </ol>
        <div class="line"><input id="tgToken" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:AA…"><button class="btn primary" data-r="tg_token" ${r.hasPin ? '' : 'disabled'}>Collega bot</button></div>
        <div class="note">Consiglio: crea un bot solo per OpenHowl e non condividere il token con nessuno.</div>`;
    } else {
      h += `<div class="line"><span class="grow">Bot <b>@${esc(tg.bot?.username || '?')}</b> · ${tg.status === 'on' ? 'connesso' : tg.status === 'error' ? 'errore' : 'spento'}</span>
        <button class="btn sm" data-r="tg_toggle">${tg.enabled ? 'Spegni' : 'Accendi'}</button></div>`;
      if (tg.error) h += `<div class="bad">${esc(tg.error)}</div>`;
      if (tg.lockedOut) h += '<div class="bad">⛔ Troppi PIN sbagliati dal telefono: accesso bloccato. <button class="btn sm" data-r="tg_reset">Riattiva</button></div>';
      if (!tg.owner) {
        const p = r.pairing?.channel === 'telegram' ? r.pairing : null;
        if (p && !p.candidate) {
          h += `<div class="ph-pair">${p.qr ? `<img src="${p.qr}" alt="QR di abbinamento">` : ''}
            <div><div class="note">Inquadra il QR col telefono, oppure apri il bot e scrivi:</div>
            <div class="ph-code">/start ${esc(p.code)}</div>
            <div class="note">Valido ancora ${mins(p.expires)} min · poi dovrai confermare qui sul PC.</div>
            <div class="line" style="margin-top:6px"><button class="btn sm" data-r="pair_cancel">Annulla</button></div></div></div>`;
        } else if (p?.candidate) {
          h += '<div class="warn">Richiesta ricevuta: conferma nella finestra che si è aperta.</div>';
        } else {
          h += `<div class="line"><span class="grow">Nessun account abbinato: il bot non risponde a nessuno.</span><button class="btn primary" data-r="tg_pair" ${tg.enabled && tg.status === 'on' ? '' : 'disabled'}>Abbina il mio Telegram</button></div>`;
        }
      } else {
        h += `<div class="line"><span class="grow">Proprietario: <b>${esc(tg.owner.name || '')}</b>${tg.owner.username ? ` (@${esc(tg.owner.username)})` : ''} · id ${esc(tg.owner.id)}</span></div>
          <div class="line"><span>Permessi</span>${modeSelect('telegram', tg.mode)}</div>
          <div class="note">${tg.unlocked ? `🔓 Sbloccato ancora per ${mins(tg.unlockedUntil)} min.` : '🔒 Bloccato: dal telefono si sblocca con /sblocca e il PIN.'}</div>
          <div class="line"><button class="btn sm" data-r="tg_unpair">Scollega account</button><button class="btn sm danger" data-r="tg_forget">Rimuovi bot</button></div>`;
      }
    }
    $('tgBox').innerHTML = h;

    // WhatsApp
    const wa = r.whatsapp;
    pill($('waPill'), wa.lockedOut ? 'bloccato' : wa.linked && wa.enabled && wa.status === 'on' ? 'attivo' : wa.status === 'qr' ? 'inquadra il QR' : wa.status === 'connecting' ? 'connessione…' : wa.linked ? 'spento' : 'non collegato',
      wa.lockedOut ? 'bad' : wa.linked && wa.enabled && wa.status === 'on' ? 'on' : 'off');
    h = '';
    if (wa.status === 'qr') {
      h = `<div class="ph-qr">${wa.qr ? `<img src="${wa.qr}" alt="QR WhatsApp">` : '<span class="spinner"></span>'}
        <ol><li>Apri WhatsApp sul telefono</li><li><b>Impostazioni → Dispositivi collegati → Collega un dispositivo</b></li><li>Inquadra questo codice</li></ol></div>
        <div class="line"><span class="grow note">Il codice cambia ogni 20 secondi e compare solo su questo schermo.</span><button class="btn sm" data-r="wa_cancel">Annulla</button></div>`;
    } else if (!wa.linked) {
      h = `${needPin}<div>Howl diventa un «dispositivo collegato» del tuo WhatsApp e ascolta <b>solo</b> la chat <b>«Messaggio a te stesso»</b> (in cima ai contatti, col tuo nome). Le altre chat vengono scartate appena arrivano: non le legge, non le salva, non le segna come lette.</div>
        <div class="warn">WhatsApp non ha un'API ufficiale per questo: OpenHowl usa una libreria non ufficiale (Baileys). Funziona bene, ma WhatsApp in rari casi può limitare l'account. Se ti preoccupa, usa Telegram.</div>
        ${wa.status === 'connecting' ? '<div class="note"><span class="spinner"></span> Connessione…</div>' : ''}
        ${wa.error ? `<div class="bad">${esc(wa.error)}</div>` : ''}
        <div class="line"><span class="grow"></span><button class="btn primary" data-r="wa_link" ${r.hasPin && wa.status !== 'connecting' ? '' : 'disabled'}>Collega WhatsApp</button></div>`;
    } else {
      h = `<div class="line"><span class="grow">Numero <b>+${esc(wa.me?.number || '?')}</b>${wa.me?.name ? ` (${esc(wa.me.name)})` : ''} · ${wa.status === 'on' ? 'connesso' : wa.status === 'connecting' ? 'connessione…' : 'spento'}</span>
          <button class="btn sm" data-r="wa_toggle">${wa.enabled ? 'Spegni' : 'Accendi'}</button></div>
        ${wa.error ? `<div class="bad">${esc(wa.error)}</div>` : ''}
        ${wa.lockedOut ? '<div class="bad">⛔ Troppi PIN sbagliati: accesso bloccato. <button class="btn sm" data-r="wa_reset">Riattiva</button></div>' : ''}
        <div class="note">Scrivi a Howl nella chat «Messaggio a te stesso». Le sue risposte iniziano con 🐺.</div>
        <div class="line"><span>Permessi</span>${modeSelect('whatsapp', wa.mode)}</div>
        <div class="note">${wa.unlocked ? `🔓 Sbloccato ancora per ${mins(wa.unlockedUntil)} min.` : '🔒 Bloccato: dal telefono si sblocca con /sblocca e il PIN.'}</div>
        <div class="line"><button class="btn sm danger" data-r="wa_unlink">Scollega WhatsApp</button></div>`;
    }
    $('waBox').innerHTML = h;

    $('phStrangers').textContent = r.strangers ? `${r.strangers} messaggi di sconosciuti ignorati` : '';
    $('phAudit').textContent = r.audit?.length
      ? r.audit.map((l) => {
        const [ts, ch, t] = l.split('\t');
        return `${new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}  ${(ch || '').padEnd(8)} ${t || ''}`;
      }).join('\n')
      : 'Ancora niente.';
  }

  let phoneTimer = null;
  function openPhone() {
    $('phone').hidden = false;
    renderRemote();
    remoteApi('state', {});
    clearInterval(phoneTimer);
    // aggiorna i minuti rimasti (sblocco, codice di abbinamento)
    phoneTimer = setInterval(() => { if ($('phone').hidden) clearInterval(phoneTimer); else renderRemote(); }, 30000);
  }
  $('phonePanel').addEventListener('click', (e) => {
    if (e.target.closest('[data-remote-stop]')) { e.stopPropagation(); remoteApi('stop', {}); return; }
    openPhone();
  });
  $('phClose').onclick = () => { $('phone').hidden = true; };
  $('phone').addEventListener('mousedown', (e) => { if (e.target.id === 'phone') $('phone').hidden = true; });

  $('phPinForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.pin.value !== f.pin2.value) return alert('I due PIN non coincidono.');
    if (remote?.hasPin && !confirm('Cambiare il PIN? Le sessioni sbloccate sul telefono verranno chiuse.')) return;
    const r = await remoteApi('pin', { pin: f.pin.value });
    if (!r.error) { f.pin.value = ''; f.pin2.value = ''; }
  };
  $('phIdle').onchange = (e) => remoteApi('options', { idleLockMin: +e.target.value });
  $('phPanic').onclick = () => { if (confirm('Spegnere subito Telegram e WhatsApp e fermare ogni lavoro partito dal telefono?')) remoteApi('lock_all', {}); };

  $('phone').addEventListener('change', (e) => {
    const s = e.target.closest('[data-mode-ch]');
    if (!s) return;
    if (s.value === 'auto' && !confirm('In modalità autonoma Howl agisce senza chiederti conferma sul telefono (le azioni pericolose restano comunque vietate). Continuare?')) { renderRemote(); return; }
    remoteApi('channel', { channel: s.dataset.modeCh, mode: s.value });
  });
  $('phone').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b || b.disabled) return;
    const a = b.dataset.r;
    const busyBtn = () => { b.disabled = true; b.textContent = '…'; };
    if (a === 'tg_token') {
      const token = $('tgToken').value.trim();
      if (!token) return $('tgToken').focus();
      busyBtn();
      await remoteApi('tg_token', { token });
    }
    if (a === 'tg_pair') { busyBtn(); await remoteApi('tg_pair', {}); }
    if (a === 'pair_cancel') remoteApi('pair_cancel', {});
    if (a === 'tg_toggle') { busyBtn(); await remoteApi('channel', { channel: 'telegram', enabled: !remote.telegram.enabled }); }
    if (a === 'wa_toggle') { busyBtn(); await remoteApi('channel', { channel: 'whatsapp', enabled: !remote.whatsapp.enabled }); }
    if (a === 'tg_reset') remoteApi('channel', { channel: 'telegram', resetLock: true });
    if (a === 'wa_reset') remoteApi('channel', { channel: 'whatsapp', resetLock: true });
    if (a === 'tg_unpair' && confirm('Scollegare il tuo account Telegram? Per ricollegarlo servirà un nuovo codice.')) remoteApi('tg_unpair', {});
    if (a === 'tg_forget' && confirm('Rimuovere il bot da OpenHowl? Il token verrà cancellato da questo PC.')) remoteApi('tg_forget', {});
    if (a === 'wa_link') { busyBtn(); await remoteApi('wa_link', {}); }
    if (a === 'wa_cancel') remoteApi('channel', { channel: 'whatsapp', enabled: false });
    if (a === 'wa_unlink' && confirm('Scollegare WhatsApp? OpenHowl sparirà dai «Dispositivi collegati» e le credenziali verranno cancellate.')) remoteApi('wa_unlink', {});
  });

  // Abbinamento Telegram: si conferma SOLO da questo schermo
  function showPairAsk(ev) {
    const w = ev.who || {};
    $('paWho').textContent = `${w.name || 'Sconosciuto'}${w.username ? `  @${w.username}` : ''}  ·  id ${w.id}`;
    $('pairAsk').hidden = false;
    $('paNo').focus();
  }
  const answerPair = (accept) => { $('pairAsk').hidden = true; remoteApi('pair_answer', { accept }); };
  $('paYes').onclick = () => answerPair(true);
  $('paNo').onclick = () => answerPair(false);

  /* ───────── LLM Wiki ───────── */
  const wikiApi = (action, body) => post(`/api/wiki/${action}`, body).then((r) => r.json());
  let wikiData = { notes: [], edges: [] };
  let wikiSelectedPage = null;
  const WIKI_COLORS = { concept: '#69a9ff', entity: '#59d2a9', project: '#f6ba66', procedure: '#c49aff', synthesis: '#ff7f96' };
  let wikiGraphRenderer = null;
  function ensureWikiGraph() {
    if (wikiGraphRenderer) return wikiGraphRenderer;
    wikiGraphRenderer = window.createNeuralWikiGraph($('wikiGraph'), {
      colors: WIKI_COLORS,
      onSelect: (id) => showWikiPage(id),
      onHover: (node, point) => {
        const tip = $('wikiGraphTip');
        tip.hidden = !node;
        if (!node) return;
        tip.innerHTML = `<b>${esc(node.title)}</b><span>${node.degree} collegamenti · ${esc(node.type)}</span>`;
        tip.style.left = `${Math.min(point.x + 16, $('wikiGraph').clientWidth - 190)}px`;
        tip.style.top = `${Math.max(54, point.y - 8)}px`;
      },
    });
    return wikiGraphRenderer;
  }
  async function openWiki() {
    $('wiki').hidden = false; $('wikiBrain').textContent = config.brain?.name || `${config.provider || ''} · ${config.model || ''}`; $('wikiStatus').hidden = true; await refreshWiki();
  }
  async function refreshWiki() {
    const r = await wikiApi('state', {});
    if (r.error) { $('wikiStatus').hidden = false; $('wikiStatus').textContent = r.error; return; }
    wikiData = r; $('wikiPageCount').textContent = r.notes.length; $('wikiSourceCount').textContent = r.sources; $('wikiPendingCount').textContent = r.pendingSources; $('wikiLinkCount').textContent = r.edges.length; $('wikiPath').textContent = `Workspace: ${r.workspace} · raw: ${r.rawPath} · wiki: ${r.path}`;
    $('wikiEmpty').hidden = !!r.notes.length; $('wikiGraph').hidden = !r.notes.length;
    if (!r.notes.length) {
      wikiSelectedPage = null;
      $('wikiNote').hidden = true;
      $('wikiNoteEmpty').hidden = false;
      $('wikiNoteEmpty').innerHTML = '<strong>Nessuna nota Wiki da eliminare</strong><span>La struttura è pronta. Carica una fonte in raw e chiedi a Gemma di fare ingest: ogni nota generata mostrerà sempre il cestino.</span>';
    } else if (!wikiSelectedPage) {
      $('wikiNoteEmpty').innerHTML = '<span>Seleziona un nodo per leggere la pagina. Il cestino accanto a ogni nota è sempre visibile.</span>';
    }
    $('wikiPages').innerHTML = r.notes.map((n) => `<div class="wiki-page-row"><button class="wiki-page-open" data-wiki-page="${esc(n.id)}"><i style="--node:${WIKI_COLORS[n.type] || WIKI_COLORS.concept}"></i><span><b>${esc(n.title)}</b><small>${esc(n.summary || n.type)}</small></span></button><button class="wiki-page-delete" data-wiki-delete="${esc(n.id)}" title="Elimina ${esc(n.title)}" aria-label="Elimina ${esc(n.title)}">${svg('trash')}</button></div>`).join('');
    drawWikiGraph(r.notes, r.edges);
  }
  function drawWikiGraph(notes, edges) {
    ensureWikiGraph().setData(notes, edges);
  }
  async function showWikiPage(ref) {
    const r=await wikiApi('note',{page:ref});if(r.error)return;wikiSelectedPage=r;ensureWikiGraph().select(r.id);$('wikiNoteDelete').hidden=false;$('wikiNoteEmpty').hidden=true;$('wikiNote').hidden=false;$('wikiNoteType').textContent=r.type;$('wikiNoteTitle').textContent=r.title;$('wikiNoteMeta').textContent=`${r.brain||r.model||'Cervello'} · ${r.sources.length} fonti`;$('wikiNoteBody').innerHTML=md(r.markdown.replace(/^---[\s\S]*?---\s*/,'').replace(/^#\s+.*\n/,''));document.querySelectorAll('[data-wiki-page]').forEach((b)=>b.classList.toggle('on',b.dataset.wikiPage===r.id));
  }
  const setWikiGraphMode=(mode)=>{ensureWikiGraph().setMode(mode);$('wikiGraph2d').classList.toggle('on',mode==='2d');$('wikiGraph3d').classList.toggle('on',mode==='3d');$('wikiGesture').textContent=mode==='3d'?'Sinistro: orbita · Shift/centrale/destro: trasla · rotella: zoom · doppio clic: centra':'Trascina: sposta · rotella: zoom · doppio clic: centra';};
  $('wikiGraph2d').onclick=()=>setWikiGraphMode('2d');
  $('wikiGraph3d').onclick=()=>setWikiGraphMode('3d');
  $('wikiGraphMotion').onclick=()=>{const on=$('wikiGraphMotion').classList.toggle('on');ensureWikiGraph().setMotion(on);};
  $('wikiGraphReset').onclick=()=>ensureWikiGraph().resetView();
  $('wikiGraphExpand').onclick=()=>{const map=$('wikiGraph').closest('.wiki-map'),expanded=map.classList.toggle('expanded');$('wikiGraphExpand').textContent=expanded?'Riduci':'Espandi';$('wikiGraphExpand').title=expanded?'Riduci il grafo':'Espandi il grafo';setTimeout(()=>ensureWikiGraph().resize(),40);};
  addEventListener('keydown',(e)=>{if(e.key==='Escape'){const map=$('wikiGraph').closest('.wiki-map');if(map.classList.contains('expanded')){$('wikiGraphExpand').click();}}});
  async function deleteWikiPageFromUi(ref) {
    const page=wikiData.notes.find((note)=>note.id===ref)||wikiSelectedPage;
    if(!page||!confirm(`Eliminare “${page.title}” dalla Wiki? La fonte raw resterà disponibile.`))return;
    const r=await wikiApi('page:delete',{page:ref});if(r.error){$('wikiStatus').hidden=false;$('wikiStatus').textContent=r.error;return;}
    wikiSelectedPage=null;ensureWikiGraph().select(null);$('wikiNote').hidden=true;$('wikiNoteEmpty').hidden=false;$('wikiStatus').hidden=false;$('wikiStatus').textContent=`Pagina “${page.title}” eliminata. La fonte raw è intatta.`;await refreshWiki();
  }
  $('wikiNoteDelete').onclick=()=>{if(wikiSelectedPage)deleteWikiPageFromUi(wikiSelectedPage.id);};
  $('wikiPages').onclick=(e)=>{const del=e.target.closest('[data-wiki-delete]');if(del)return deleteWikiPageFromUi(del.dataset.wikiDelete);const b=e.target.closest('[data-wiki-page]');if(b)showWikiPage(b.dataset.wikiPage);};
  $('wikiClose').onclick=()=>{$('wiki').hidden=true;};
  $('wiki').addEventListener('mousedown',(e)=>{if(e.target.id==='wiki')$('wiki').hidden=true;});
  $('wikiAsk').onsubmit=async(e)=>{e.preventDefault();const q=$('wikiQuestion').value.trim();if(!q)return;const save=$('wikiSaveAnswer').checked;await wikiApi('query:log',{question:q,save});$('wiki').hidden=true;input.value=`Consulta la LLM Wiki del progetto. Parti da index.md, segui i wikilink pertinenti, confronta le pagine e cita pagine e fonti usate. Domanda: ${q}${save?'\nDopo la risposta, se emerge una sintesi durevole, salvala nella Wiki con lo strumento wiki action=write, includendo wikilink e fonti.':''}`;send();};
  async function ingestSelected(fileList) {
    const picked=[...fileList];if(!picked.length)return;const total=picked.reduce((n,f)=>n+f.size,0);if(total>40*1024*1024)return alert('Le fonti selezionate superano 40 MB. Importale in gruppi più piccoli.');
    if(picked.some((f)=>f.size>30*1024*1024))return alert('Un file supera il limite di 30 MB.');
    $('wikiStatus').hidden=false;$('wikiStatus').innerHTML='<span class="spinner"></span> Salvo le fonti in raw…';
    try {
      const files=await Promise.all(picked.map(async(f)=>{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(f);});return{name:f.name,path:f.webkitRelativePath||f.name,type:f.type,data:String(dataUrl).split(',')[1]||''};}));
      const r=await wikiApi('upload',{files});if(r.error){$('wikiStatus').textContent=r.error;return;}$('wikiStatus').innerHTML=`<b>${r.stored.length}</b> ${r.stored.length===1?'fonte salvata':'fonti salvate'} in raw. Ora chiedi a Gemma: “fai ingest dei nuovi file”.`;await refreshWiki();
    } catch (error) {
      $('wikiStatus').textContent = `Caricamento non riuscito: ${error.message}`;
    } finally {
      $('wikiFiles').value='';
    }
  }
  $('wikiFiles').onchange=(e)=>ingestSelected(e.target.files);$('wikiDrop').ondragover=(e)=>{e.preventDefault();$('wikiDrop').classList.add('over');};$('wikiDrop').ondragleave=()=>$('wikiDrop').classList.remove('over');$('wikiDrop').ondrop=(e)=>{e.preventDefault();$('wikiDrop').classList.remove('over');ingestSelected(e.dataTransfer.files);};
  function showWikiDocument(title, content) {
    wikiSelectedPage=null;$('wikiNoteDelete').hidden=true;$('wikiNoteEmpty').hidden=true;$('wikiNote').hidden=false;$('wikiNoteType').textContent='manutenzione';$('wikiNoteTitle').textContent=title;$('wikiNoteMeta').textContent='LLM Wiki';$('wikiNoteBody').innerHTML=md(content||'');
  }
  $('wikiLint').onclick=async()=>{$('wikiStatus').hidden=false;$('wikiStatus').innerHTML='<span class="spinner"></span> Il cervello cerca contraddizioni, pagine superate e lacune…';const r=await wikiApi('health',{});if(r.error){$('wikiStatus').textContent=r.error;return;}const l=r.structural;$('wikiStatus').textContent=`Controllo completato · ${l.broken.length} link rotti · ${l.orphans.length} pagine isolate`;showWikiDocument('Controllo della Wiki',r.report);};
  $('wikiLog').onclick=async()=>{const r=await wikiApi('log',{});if(r.error)return;showWikiDocument('Registro',r.log);};
  $('wikiSchema').onclick=async()=>{const r=await wikiApi('schema:get',{});if(r.error)return;wikiSelectedPage=null;$('wikiNoteDelete').hidden=true;$('wikiNoteEmpty').hidden=true;$('wikiNote').hidden=false;$('wikiNoteType').textContent='regole del cervello';$('wikiNoteTitle').textContent='Schema della Wiki';$('wikiNoteMeta').textContent='Definisce struttura, ingestione, query e manutenzione';$('wikiNoteBody').innerHTML=`<textarea class="wiki-schema-editor" id="wikiSchemaEditor">${esc(r.schema)}</textarea><button class="wiki-schema-save" id="wikiSchemaSave">Salva schema</button>`;$('wikiSchemaSave').onclick=async()=>{const out=await wikiApi('schema:save',{schema:$('wikiSchemaEditor').value});$('wikiStatus').hidden=false;$('wikiStatus').textContent=out.error||'Schema aggiornato.';};};

  /* ───────── laboratorio del branco ───────── */
  const brancoApi = async (action, body) => {
    const r = await post(`/api/branco/${action}`, body).then(x => x.json()).catch(e => ({ error: e.message }));
    if (r.error) { alert(r.error); }
    return r;
  };
  let bcRunning = null;

  // Tab switching
  document.querySelectorAll('.bc-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.bc-tab').forEach(b => b.classList.remove('on'));
      document.querySelectorAll('.bc-panel').forEach(p => p.hidden = true);
      btn.classList.add('on');
      $(`bcTab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === 'addestramento') $('bcNote').textContent = 'Il laboratorio usa solo modelli locali. Durante la corsa il modello è occupato: meglio non chattare con Howl, o i tempi misurati diventano falsi.';
      if (btn.dataset.tab === 'corse') refreshBranco();
      if (btn.dataset.tab === 'fondatori') loadFondatori();
      if (btn.dataset.tab === 'dominio') loadMondo();
    };
  });

  let mondoCorrente = null;

  async function loadMondo() {
    const r = await brancoApi('mondo:get', {});
    mondoCorrente = r.mondo || null;
    if (mondoCorrente) {
      const f = $('mondoForm').elements;
      f.nome.value = mondoCorrente.nome || '';
      f.ruolo.value = mondoCorrente.ruolo || '';
      f.contesto.value = mondoCorrente.contesto || '';
      f.tipoRisposta.value = mondoCorrente.tipoRisposta || 'numero';
      if (mondoCorrente.esame?.length) renderEsame(mondoCorrente.esame, mondoCorrente.segreto || []);
    }
  }

  function renderEsame(esame, segreto) {
    $('mondoEsame').hidden = false;
    const renderList = (items, container) => {
      container.innerHTML = items.map((q, i) => `
        <div class="esame-item">
          <div class="esame-q"><b>${q.id}</b> ${esc(q.domanda)}</div>
          <div class="esame-a">
            <strong>${esc(String(q.risposta))}</strong>
            <button data-edit-q="${i}" data-edit-tipo="${container.id}" title="Modifica risposta">✎</button>
          </div>
          ${q.spiegazione ? `<div class="esame-spieg">${esc(q.spiegazione)}</div>` : ''}
        </div>
      `).join('');
    };
    renderList(esame, $('mondoEsameList'));
    renderList(segreto, $('mondoSegretoList'));
  }

  $('mondoForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const btn = $('mondoGenBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Generazione in corso…';
    $('mondoNote').textContent = 'Il modello sta generando le domande d\'esame, ci vogliono ~20 secondi…';
    try {
      const mondo = { nome: f.nome.value, ruolo: f.ruolo.value, contesto: f.contesto.value, tipoRisposta: f.tipoRisposta.value };
      const r = await brancoApi('mondo:genera', mondo);
      if (r.esame) {
        mondoCorrente = { ...mondo, esame: r.esame, segreto: r.segreto };
        renderEsame(r.esame, r.segreto);
        $('mondoNote').textContent = `✓ ${r.esame.length} domande d'esame + ${r.segreto.length} segrete generate. Rivedi e poi salva.`;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Genera esame automaticamente';
    }
  };

  $('mondoRigenBtn').onclick = () => $('mondoForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

  $('mondoSaveBtn').onclick = async () => {
    if (!mondoCorrente?.esame?.length) return alert('Genera prima le domande d\'esame.');
    const r = await brancoApi('mondo:save', mondoCorrente);
    if (!r.error) {
      $('mondoNote').textContent = '✓ Dominio salvato.';
      document.querySelector('.bc-tab[data-tab="fondatori"]').click();
    }
  };

  let fondatoriCustom = [];
  let editingFndId = null;

  async function loadFondatori() {
    const r = await brancoApi('fondatori:list', {});
    fondatoriCustom = r.fondatori || [];
    renderFondatori();
  }

  function renderFondatori() {
    const box = $('fndList');
    if (!fondatoriCustom.length) {
      box.innerHTML = '<div class="chats-empty">Nessun fondatore custom. Usa i predefiniti o creane uno.</div>';
      return;
    }
    box.innerHTML = fondatoriCustom.map(f => `
      <div class="br-item">
        <div class="br-item-main">
          <b>🐺 ${esc(f.nome)}</b> <span class="muted">· Fam. ${esc(f.famiglia || 'A')} · ragion: ${esc(f.ragionamento || 'low')} · temp: ${esc(String(f.temperatura ?? 0.3))}</span>
          <small>${esc(f.persona || '')}</small>
        </div>
        <div class="br-item-acts">
          <button data-fnd-test="${esc(f.id)}" title="Prova su una domanda">▶ Prova</button>
          <button data-fnd-edit="${esc(f.id)}" title="Modifica">✎</button>
          <button data-fnd-del="${esc(f.id)}" title="Elimina">🗑</button>
        </div>
      </div>
    `).join('');
  }

  $('fndNew').onclick = () => {
    editingFndId = null;
    $('fndForm').reset();
    $('fndFormTitle').textContent = 'Crea fondatore';
    $('fndTestOut').hidden = true;
    $('fndForm').hidden = false;
  };

  $('fndCancel').onclick = () => { $('fndForm').hidden = true; };

  $('fndList').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fndDel) {
      if (!confirm('Eliminare questo fondatore?')) return;
      const r = await brancoApi('fondatori:delete', { id: b.dataset.fndDel });
      if (!r.error) { fondatoriCustom = r.fondatori || []; renderFondatori(); }
    }
    if (b.dataset.fndEdit) {
      const f = fondatoriCustom.find(x => x.id === b.dataset.fndEdit);
      if (!f) return;
      editingFndId = f.id;
      const el = $('fndForm').elements;
      el.nome.value = f.nome || '';
      el.famiglia.value = f.famiglia || 'A';
      el.persona.value = f.persona || '';
      el.ragionamento.value = f.ragionamento || 'low';
      el.temperatura.value = f.temperatura ?? 0.3;
      el.passiMax.value = f.passiMax || 10;
      $('fndFormTitle').textContent = 'Modifica fondatore';
      $('fndTestOut').hidden = true;
      $('fndForm').hidden = false;
    }
    if (b.dataset.fndTest) {
      const f = fondatoriCustom.find(x => x.id === b.dataset.fndTest);
      if (!f) return;
      runFndTest(f);
    }
  };

  async function runFndTest(fondatore) {
    const out = $('fndTestOut');
    out.hidden = false;
    out.textContent = '⏳ Test in corso (~30 secondi)…';
    const r = await brancoApi('fondatori:test', { fondatore });
    if (r.error) { out.textContent = '✗ Errore: ' + r.error; return; }
    out.textContent = `${r.ok ? '✓' : '✗'} Risposta: ${r.risposta ?? 'nessuna'} · ${r.passi} passi · ${r.secondi}s\n${(r.trace || []).join('\n')}`;
  }

  $('fndTestBtn').onclick = async () => {
    const f = $('fndForm').elements;
    const fondatore = { nome: f.nome.value, persona: f.persona.value, ragionamento: f.ragionamento.value, temperatura: +f.temperatura.value, passiMax: +f.passiMax.value };
    runFndTest(fondatore);
  };

  $('fndForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const body = { fondatore: { id: editingFndId, nome: f.nome.value, famiglia: f.famiglia.value, persona: f.persona.value, ragionamento: f.ragionamento.value, temperatura: +f.temperatura.value, passiMax: +f.passiMax.value } };
    const r = await brancoApi('fondatori:save', body);
    if (!r.error) {
      fondatoriCustom = r.fondatori || [];
      renderFondatori();
      $('fndForm').hidden = true;
    }
  };

  async function refreshBranco() {
    const r = await brancoApi('list', {});
    if (r.error) return;
    bcRunning = r.inCorso;
    $('bcStart').hidden = !!bcRunning;
    $('bcStop').hidden = !bcRunning;
    for (const el of $('bcForm').querySelectorAll('select, input:not([name=modello])')) el.disabled = !!bcRunning;
    $('bcList').innerHTML = r.corse.length ? r.corse.map((c) => `<div class="br-item bc-item ${['in corso', 'in pausa'].includes(c.stato) ? 'active' : ''}">
        <div><div class="n">${esc(c.creato)} · ${c.obiettivo === 'intelligenza' ? 'solo intelligenza' : 'intelligenza + velocità'} · ${esc(c.stato)}</div>
        <div class="m">${esc(c.modello)} · ${c.esaminati}/${c.previsti} agenti${c.alfa ? ` · ★ alfa ${esc(c.alfa.nome)} ${c.alfa.voto} in ${c.alfa.secondi}s${c.alfa.segreto ? ` · esame segreto ${c.alfa.segreto}` : ''}` : ''}</div></div>
        <div class="acts"><button class="use" data-graph="${esc(c.id)}">Grafo</button>${c.stato === 'in corso' ? '' : `<button class="danger" data-delete-run="${esc(c.id)}" title="Elimina questa corsa">Elimina</button>`}</div></div>`).join('')
      : '<span class="muted">Nessuna corsa ancora. Serve un modello locale attivo (es. Qwen su LM Studio): una corsa da 4 generazioni dura circa un\'ora.</span>';
  }
  function openBranco() {
    $('branco').hidden = false;
    const f = $('bcForm').elements;
    f.modello.value = config.brain ? config.brain.name : config.model || '';
    if (mondoCorrente) {
      document.querySelector('.bc-tab[data-tab="corse"]').click();
    } else {
      document.querySelector('.bc-tab[data-tab="dominio"]').click();
    }
  }
  $('bcClose').onclick = () => { $('branco').hidden = true; };
  $('branco').addEventListener('mousedown', (e) => { if (e.target.id === 'branco') $('branco').hidden = true; });
  $('bcForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    $('bcLog').textContent = ''; $('bcLog').hidden = false;
    const r = await brancoApi('start', {
      obiettivo: f.obiettivo.value,
      generazioni: +f.generazioni.value,
      figli: +f.figli.value,
      riprendi: f.riprendi.checked,
      famiglie: +f.famiglie.value || 1,
      migrazione: +f.migrazione.value || 2,
      crossbreed: f.crossbreed.checked,
      useDefault: fndUsaDefault.checked
    });
    if (r.error) { $('bcLog').hidden = true; return; }
    refreshBranco();
    openGraph(r.id);
  };
  $('bcStop').onclick = async () => { if (confirm('Fermare la corsa? Gli agenti già esaminati restano salvati.')) { await brancoApi('stop', {}); setTimeout(refreshBranco, 500); } };
  $('bcList').onclick = async (e) => {
    const graph = e.target.closest('[data-graph]');
    if (graph) return openGraph(graph.dataset.graph);
    const del = e.target.closest('[data-delete-run]');
    if (!del || !confirm('Eliminare definitivamente questa corsa e tutti i suoi risultati?')) return;
    del.disabled = true;
    const r = await brancoApi('delete', { id: del.dataset.deleteRun });
    if (!r.error) refreshBranco(); else del.disabled = false;
  };
  let graphReturnFocus = null;
  let graphRunId = null;
  async function refreshGraphActions() {
    if (!graphRunId || $('bcGraph').hidden) return;
    const r = await brancoApi('list', {});
    if (r.error) return;
    const run = r.corse.find((c) => c.id === graphRunId);
    const pausable = run && ['in corso', 'in pausa'].includes(run.stato);
    $('bcGraphPause').hidden = !pausable;
    $('bcGraphPause').dataset.paused = run?.stato === 'in pausa' ? 'true' : 'false';
    $('bcGraphPause').textContent = run?.stato === 'in pausa' ? '▶ Riprendi' : 'Ⅱ Metti in pausa';
    $('bcGraphDelete').hidden = !run;
  }
  function openGraph(id) {
    graphReturnFocus = document.activeElement;
    graphRunId = id;
    $('bcFrame').src = `/branco.html?corsa=${encodeURIComponent(id)}`;
    $('bcGraph').hidden = false;
    refreshGraphActions();
    requestAnimationFrame(() => $('bcGraphClose').focus());
  }
  function closeGraph() {
    $('bcGraph').hidden = true;
    $('bcFrame').src = 'about:blank';
    graphRunId = null;
    graphReturnFocus?.focus?.();
    graphReturnFocus = null;
  }
  $('bcGraphClose').onclick = closeGraph;
  $('bcGraphPause').onclick = async () => {
    const action = $('bcGraphPause').dataset.paused === 'true' ? 'resume' : 'pause';
    const r = await brancoApi(action, {});
    if (!r.error) { refreshBranco(); refreshGraphActions(); }
  };
  $('bcGraphDelete').onclick = async () => {
    if (!graphRunId || !confirm('Eliminare questa corsa? Se è ancora attiva verrà fermata e tutti i risultati saranno rimossi.')) return;
    const r = await brancoApi('delete', { id: graphRunId });
    if (!r.error) { closeGraph(); refreshBranco(); }
  };

  /* ───────── cartella di lavoro ───────── */
  function renderWsMenu() {
    const recent = (config.recentWorkspaces || []).filter((d) => d !== config.workspace);
    $('wsMenu').innerHTML =
      `<div class="ws-cur">Howl lavora in<br><b>${esc(config.workspace || '')}</b>${config.sandbox ? '<br>🔒 Crea e modifica file solo qui dentro. Fuori può soltanto leggere.' : ''}</div>` +
      recent.map((d) => `<button data-ws="${esc(d)}">${svg('folder')}<span><b>${esc(d.split(/[\\/]/).filter(Boolean).at(-1) || d)}</b><small>${esc(d)}</small></span></button>`).join('') +
      `<button data-ws-pick>${svg('folder')}<span><b>Scegli un'altra cartella…</b><small>Apre il selettore di cartelle</small></span></button>`;
  }
  $('wsMenu').onclick = (e) => {
    const b = e.target.closest('[data-ws],[data-ws-pick]');
    if (!b) return;
    closeMenus();
    if (b.dataset.ws) setWorkspace(b.dataset.ws);
    else pickWorkspace();
  };
  // nuova chat dentro un progetto (se è un altro progetto, Howl passa prima alla sua cartella)
  async function startInProject(dir) {
    if (pkey(dir) !== pkey(config.workspace)) await setWorkspace(dir);
    post('/api/chat/new');
  }
  const newProjectBtn = $('newProject');
  if (newProjectBtn) newProjectBtn.onclick = async () => {
    const dir = desk?.pickFolder ? await desk.pickFolder(config.workspace) : prompt('Cartella del nuovo progetto:', '');
    if (dir) { await setWorkspace(dir); post('/api/chat/new'); }
  };
  async function pickWorkspace() {
    const dir = desk?.pickFolder ? await desk.pickFolder(config.workspace) : prompt('Percorso della cartella di lavoro:', config.workspace || '');
    if (dir) setWorkspace(dir);
  }
  async function setWorkspace(dir) {
    const r = await post('/api/workspace', { path: dir }).then((x) => x.json()).catch((e) => ({ error: e.message }));
    if (r.error) alert(r.error);
  }

  // Electron non garantisce l'autofocus dopo il primo paint: rendiamo il compositore subito pronto.
  const focusComposer = () => { if (!document.hidden && !$('approval').hidden && !$('userAction').hidden && document.activeElement === document.body) input.focus(); };
  addEventListener('focus', () => setTimeout(focusComposer, 0));
  setTimeout(focusComposer, 160);
  connect();
})();
