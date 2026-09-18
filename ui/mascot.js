// Mascotte sul desktop: segue gli eventi dell'agente, cambia posa, parla, si trascina.
(() => {
  const TOKEN = document.querySelector('meta[name=howl-token]').content;
  const desk = window.howlDesktop;
  const $ = (id) => document.getElementById(id);
  const bubble = $('bubble'), txt = $('txt'), wolf = $('wolf');

  const howl = window.HowlWolf.mount($('howl'), { variant: 'shadow', sleepAfter: 3 * 60 * 1000 });
  const TOOL_SAY = {
    read_file: 'Leggo un file', write_file: 'Scrivo un file', edit_file: 'Modifico il codice', create_folder: 'Creo una cartella', run_command: 'Eseguo un comando',
    web_search: 'Cerco sul web', web_fetch: 'Leggo una pagina', browser: 'Navigo nel browser', computer: 'Uso il tuo PC',
    delegate: 'Chiamo il branco', grep: 'Cerco nel codice', glob: 'Cerco file', todo_write: 'Aggiorno il piano', submit_verdict: 'Controllo il lavoro',
  };
  let state = 'idle', hideTimer = null, resetTimer = null;

  function say(text, { kind = '', stay = false, dots = false } = {}) {
    txt.innerHTML = '';
    txt.textContent = text;
    if (dots) txt.insertAdjacentHTML('beforeend', ' <span class="dots"><span></span><span></span><span></span></span>');
    bubble.className = `bubble show ${kind}`;
    clearTimeout(hideTimer);
    if (!stay) hideTimer = setTimeout(() => bubble.classList.remove('show'), 4500);
  }

  function setState(next, opts = {}) {
    clearTimeout(resetTimer);
    state = next;
    document.body.dataset.state = next;
    howl.set(next, opts);
    if (next === 'success' || next === 'goal') { sparks(); resetTimer = setTimeout(() => setState('idle'), next === 'goal' ? 3400 : 2600); }
    if (next === 'error') resetTimer = setTimeout(() => setState('idle'), 4200);
  }

  function sparks() {
    const r = wolf.getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 60;
      s.style.left = `${r.left + r.width / 2}px`;
      s.style.top = `${r.top + r.height * 0.35}px`;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      s.style.background = ['#14b8a6', '#22c55e', '#f59e0b', '#38bdf8'][i % 4];
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  /* ── eventi dall'agente ── */
  let pendingApprovals = 0;
  function handle(ev) {
    const sub = ev.agent && ev.agent !== 'main';
    switch (ev.type) {
      case 'snapshot':
        document.body.classList.toggle('busy', !!ev.busy);
        if (!ev.busy) { say('Ciao! Clicca su di me per parlarmi.'); howl.hello(); }
        break;
      case 'busy':
        document.body.classList.toggle('busy', ev.busy);
        if (!ev.busy && state !== 'error') bubble.classList.remove('show');
        break;
      case 'state':
        if (ev.state === 'thinking') { setState('thinking'); say(ev.agent === 'verifier' ? 'Controllo il lavoro' : 'Ci penso', { stay: true, dots: true }); }
        else if (ev.state === 'streaming') { setState('streaming'); say('Ti rispondo', { stay: true, dots: true }); }
        else if (ev.state === 'success') { setState('success'); say('Fatto! 🐾'); }
        else if (ev.state === 'error') setState('error');
        else if (ev.state === 'idle') { setState('idle'); bubble.classList.remove('show'); }
        break;
      case 'tool_start':
        setState('tool', { tool: ev.name });
        say(`${sub ? '🐺 ' : ''}${TOOL_SAY[ev.name] || `Uso ${ev.name}`}`, { stay: true, dots: true });
        break;
      case 'approval_request':
        pendingApprovals++;
        setState('approval');
        say('Mi serve il tuo permesso — cliccami', { kind: 'approval', stay: true });
        break;
      case 'user_action_request':
        setState('waiting');
        say('Serve una verifica "non sono un robot": completala nel browser', { kind: 'approval', stay: true });
        break;
      case 'user_action_resolved':
        say(ev.outcome === 'done' ? 'Grazie! Riprendo 🐾' : 'Ok, lascio stare quel sito.');
        break;
      case 'approval_resolved':
        pendingApprovals = Math.max(0, pendingApprovals - 1);
        if (!pendingApprovals) bubble.classList.remove('show');
        break;
      case 'error':
        setState('error');
        say(ev.text.slice(0, 120), { kind: 'error' });
        break;
      case 'task_started':
        if (state === 'idle') setState('tool', { tool: 'schedule_task' });
        say(`🕗 ${ev.name}`, { stay: true, dots: true });
        break;
      case 'task_done':
        setState(ev.ok ? 'success' : 'error');
        say(`${ev.ok ? '✅' : '⚠️'} ${ev.name}: ${String(ev.report || '').replace(/[#*`>]/g, '').slice(0, 110)}`, { kind: ev.ok ? '' : 'error' });
        break;
      case 'goal_phase':
        if (ev.phase === 'achieved') { setState('goal'); say('Obiettivo raggiunto! 🎯 Auuuuu!'); }
        else if (ev.phase === 'verifying') say(`Verifico il lavoro (giro ${ev.iteration})`, { stay: true, dots: true });
        break;
    }
  }

  const es = new EventSource(`/api/events?t=${TOKEN}`);
  es.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch {} };

  $('stop').onclick = (e) => {
    e.stopPropagation();
    fetch('/api/stop', { method: 'POST', headers: { 'x-howl-token': TOKEN, 'content-type': 'application/json' }, body: '{}' });
    say('Mi fermo.');
  };
  bubble.addEventListener('click', () => { if (bubble.classList.contains('approval')) desk?.openApp(); });

  /* ── trascinamento e clic ── */
  let drag = null;
  wolf.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    wolf.setPointerCapture(e.pointerId);
    drag = { sx: e.screenX, sy: e.screenY, ox: e.screenX - window.screenX, oy: e.screenY - window.screenY, moved: false };
  });
  wolf.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.screenX - drag.sx) + Math.abs(e.screenY - drag.sy) > 4) drag.moved = true;
    if (drag.moved) desk?.moveMascot(e.screenX - drag.ox, e.screenY - drag.oy);
  });
  wolf.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.moved) desk?.mascotMoved();
    else desk ? desk.openApp() : window.open('/', '_blank');
    drag = null;
  });
  let lastHover = 0;
  wolf.addEventListener('pointerenter', () => {
    if (drag || Date.now() - lastHover < 8000) return;
    lastHover = Date.now();
    if (howl.state === 'sleeping') { howl.wake(); say('Eh? Ero solo a occhi chiusi… 🐺'); }
    else howl.wave();
  });
  wolf.addEventListener('contextmenu', (e) => { e.preventDefault(); desk?.mascotMenu(); });
})();
