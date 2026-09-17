// OpenHowl — interfaccia: riceve gli eventi dell'agente (SSE) e li trasforma in UI.
(() => {
  const TOKEN = document.querySelector('meta[name=howl-token]').content;
  const desk = window.howlDesktop;
  const $ = (id) => document.getElementById(id);
  const feed = $('feed'), input = $('input');
  if (desk) document.body.classList.add('desktop');

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-howl-token': TOKEN }, body: JSON.stringify(body || {}) });

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
  };
  const ICON_OF = {
    read_file: 'file', write_file: 'pen', edit_file: 'pen', create_folder: 'folder', list_dir: 'folder', glob: 'search', grep: 'search',
    run_command: 'term', process_output: 'term', web_search: 'globe', web_fetch: 'globe', browser: 'compass',
    computer: 'mouse', todo_write: 'list', remember: 'brain', delegate: 'paw', submit_verdict: 'scale', schedule_task: 'clock',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24">${P[k]}</svg>`;
  const icon = (name) => svg(ICON_OF[name] || (name.startsWith('mcp__') ? 'plug' : 'cog'));

  const TOOL_SAY = {
    read_file: 'Legge un file', write_file: 'Scrive un file', edit_file: 'Modifica il codice', create_folder: 'Crea una cartella',
    run_command: 'Esegue un comando', web_search: 'Cerca sul web', web_fetch: 'Legge una pagina', browser: 'Naviga nel browser',
    computer: 'Usa il computer', delegate: 'Chiama il branco', grep: 'Cerca nel codice', glob: 'Cerca file',
    todo_write: 'Aggiorna il piano', remember: 'Prende nota', submit_verdict: 'Verifica il lavoro', schedule_task: 'Programma un\'automazione',
  };
  const STATE_LABEL = { idle: 'Inattivo', thinking: 'Sta ragionando', streaming: 'Sta rispondendo', tool: 'Al lavoro', approval: 'Attende il tuo permesso', waiting: 'In pausa, attende te', success: 'Completato', error: 'Errore' };
  const POSE = { idle: 'idle', streaming: 'idle', success: 'success', thinking: 'thinking', tool: 'working', approval: 'approval', waiting: 'approval', error: 'approval' };
  const MODES = [
    ['readonly', 'Sola lettura', 'Può solo leggere e cercare. Non modifica nulla sul computer.', 'eye'],
    ['ask', 'Chiedi conferma', 'Chiede il permesso prima di scrivere file, eseguire comandi o usare mouse e tastiera.', 'hand'],
    ['auto', 'Autonomo', 'Agisce da solo. I comandi distruttivi chiedono comunque conferma.', 'bolt'],
  ];

  let commands = [], config = {}, replaying = false, resetTimer = null, sessions = [], currentId = null;
  let tasks = [], taskRunning = null, taskTool = null;
  const segs = new Map(), tools = new Map();
  let approvalQueue = [];

  /* ───────── stato del lupo ───────── */
  function wolf(state, say) {
    if (replaying) return;
    clearTimeout(resetTimer);
    document.body.dataset.state = state;
    $('wolfMini').dataset.state = state;
    $('stateLabel').textContent = say || STATE_LABEL[state] || state;
    $('wolfMini').querySelectorAll('img').forEach((i) => i.classList.toggle('on', i.dataset.pose === POSE[state]));
    if (state === 'success') confetti();
    if (state === 'success' || state === 'error') resetTimer = setTimeout(() => wolf('idle'), state === 'success' ? 2600 : 4000);
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
  function renderChats() {
    const box = $('chats');
    if (!sessions.length) { box.innerHTML = '<div class="chats-empty">Le tue conversazioni appariranno qui.</div>'; return; }
    let html = '', group = '';
    for (const s of sessions) {
      const g = dayGroup(s.updatedAt);
      if (g !== group) { group = g; html += `<div class="chats-day">${g}</div>`; }
      html += `<div class="chat-item ${s.id === currentId ? 'on' : ''}" data-id="${esc(s.id)}" title="${esc(s.title)}">
        <span class="t">${esc(s.title)}</span>
        <span class="when">${when(s.updatedAt)}</span>
        <span class="row-acts"><button data-ren="${esc(s.id)}" title="Rinomina">${svg('edit')}</button><button data-del="${esc(s.id)}" title="Elimina">${svg('trash')}</button></span>
      </div>`;
    }
    box.innerHTML = html;
  }
  $('chats').addEventListener('click', (e) => {
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
    config = c;
    $('brainName').textContent = c.brain ? c.brain.name : `${c.provider} · ${c.model}`;
    $('wsPath').textContent = c.workspace;
    $('toolCount').textContent = `${c.tools.length} strumenti collegati`;
    const mode = MODES.find((m) => m[0] === c.mode) || MODES[1];
    $('modeLabel').textContent = mode[1];
    $('modeIcon').innerHTML = svg(mode[3]);
    $('modeMenu').innerHTML = MODES.map(([id, label, descr, ic]) =>
      `<button data-mode="${id}" class="${id === c.mode ? 'on' : ''}">${svg(ic)}<span><b>${label}</b><small>${descr}</small></span>${id === c.mode ? '<span class="check">✓</span>' : ''}</button>`).join('');
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
      case 'user': add(div('msg user')).textContent = ev.text; break;
      case 'text_delta': {
        const s = assistantEl(ev);
        s.raw += ev.text;
        s.el.classList.add('live');
        if (!s.pending) { s.pending = true; requestAnimationFrame(() => { s.pending = false; renderSeg(s); if (nearBottom()) feed.scrollTop = feed.scrollHeight; }); }
        break;
      }
      case 'assistant_text': { const s = assistantEl(ev); s.raw = ev.text; s.el.classList.remove('live'); renderSeg(s); break; }
      case 'thinking_delta': { const s = thinkingEl(ev); s.raw += ev.text; s.el.lastElementChild.textContent = s.raw; break; }
      case 'thinking': { const s = thinkingEl(ev); s.raw = ev.text; s.el.lastElementChild.textContent = s.raw; break; }
      case 'tool_start': toolStart(ev); wolf('tool', TOOL_SAY[ev.name] || ev.name); break;
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
        if (ev.phase === 'achieved') wolf('success', 'Obiettivo raggiunto');
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
    const es = new EventSource(`/api/events?t=${TOKEN}`);
    es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  };

  /* ───────── composer ───────── */
  function send(text) {
    text = text.trim();
    if (!text) return;
    post('/api/message', { text });
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
  input.addEventListener('input', () => { autosize(); sugIndex = 0; updateSuggest(); });
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
  $('moreBtn').onclick = (e) => { e.stopPropagation(); toggleMenu('moreDd', 'moreMenu'); };
  $('modeMenu').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) { send(`/mode ${b.dataset.mode}`); closeMenus(); } };
  $('moreMenu').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMenus();
    const act = b.dataset.act;
    if (act === 'tasks') openTasks();
    if (act === 'cwd') { input.value = `/cwd ${config.workspace}`; input.focus(); }
    if (act === 'compact') send('/compact');
    if (act === 'memory') send('/memory');
    if (act === 'tools') send('/tools');
    if (act === 'help') send('/help');
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
    const t = e.target;
    if (t.dataset.use) await brainApi('activate', { id: t.dataset.use });
    if (t.dataset.edit) openForm(config.brains.find((b) => b.id === t.dataset.edit));
    if (t.dataset.del && confirm('Eliminare questo modello?')) await brainApi('delete', { id: t.dataset.del });
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
      const existing = config.brains.find((x) => x.baseUrl === s.baseUrl && x.model === m);
      b.textContent = '…';
      if (existing) await brainApi('activate', { id: existing.id });
      else await brainApi('save', { activate: true, brain: { name: `${m.split('/').pop()} (${s.name})`, kind: 'openai', baseUrl: s.baseUrl, model: m, contextLimit: 32000, maxTokens: 4096 } });
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

  connect();
})();
