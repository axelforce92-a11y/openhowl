// Howl animato, condiviso tra la finestra principale e la mascotte sul desktop.
// Sceglie la posa giusta per lo stato dell'agente (e per lo strumento che sta usando), la fa vivere
// con piccoli gesti casuali (battito di ciglia, testa inclinata, saluto) e dopo un po' di calma lo fa dormire.
//
//   const w = HowlWolf.mount(elemento, { variant: 'mini' | 'shadow', sleepAfter: ms });
//   w.set('tool', { tool: 'web_search' });   w.hello();   w.listen(true);
(() => {
  const BASE_H = 700; // altezza delle pose "normali": le altre si scalano in proporzione
  const TOOL_POSE = {
    web_search: 'searching', grep: 'searching', glob: 'searching', browser: 'searching',
    read_file: 'reading', web_fetch: 'reading', list_dir: 'reading', process_output: 'reading', submit_verdict: 'reading', skill: 'reading',
    delegate: 'howling', remember: 'listening', schedule_task: 'thumbsup', todo_write: 'thinking',
  };
  // stati che durano poco e poi tornano da soli a "idle"
  const TRANSIENT = { success: 2600, goal: 3400, error: 4200, hello: 2600, yawning: 1500 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let manifest = null;
  const ready = fetch('wolf/rig/rig.json').then((r) => r.json()).then((m) => (manifest = m)).catch(() => (manifest = {}));

  function poseFor(state, opts = {}) {
    switch (state) {
      case 'thinking': return 'thinking';
      case 'streaming': return 'talking';
      case 'tool': return TOOL_POSE[opts.tool] || 'working';
      case 'approval': return 'approval';
      case 'waiting': return 'pointing';
      case 'success': return Math.random() < 0.5 ? 'success' : 'thumbsup';
      case 'goal': return 'howling';
      case 'error': return 'worried';
      case 'sleeping': return 'sleeping';
      case 'hello': return 'hello';
      case 'listening': return 'listening';
      case 'yawning': return 'yawning';
      default: return 'idle';
    }
  }

  function build(root, variant) {
    root.classList.add('hw', variant === 'mini' ? 'hw-mini' : 'hw-shadow');
    const body = document.createElement('div');
    body.className = 'hw-body';
    const fx = document.createElement('div');
    fx.className = 'hw-fx';
    fx.innerHTML = '<i>Z</i><i>z</i><i>z</i>';
    const poses = {};
    for (const [name, p] of Object.entries(manifest)) {
      const el = document.createElement('div');
      el.className = 'hw-pose';
      el.dataset.pose = name;
      el.style.height = `${(p.h / BASE_H) * 100}%`;
      el.style.aspectRatio = `${p.w} / ${p.h}`;
      if (p.layers) {
        for (const l of p.layers) {
          const img = new Image();
          img.src = `wolf/rig/${name}-${l.name}.png`;
          img.className = `p-${l.name}`;
          img.style.transformOrigin = `${l.pivot[0]}% ${l.pivot[1]}%`;
          img.alt = '';
          el.appendChild(img);
          // le palpebre vanno subito sopra la testa (sotto le braccia alzate) e ne seguono i movimenti
          if (l.name === (p.lidsOn || 'body')) {
            for (const lid of ['lids', 'lidshalf']) {
              const li = new Image();
              li.src = `wolf/rig/${name}-${lid}.png`;
              li.className = `${lid} p-${l.name}`;
              li.style.transformOrigin = img.style.transformOrigin;
              li.alt = '';
              el.appendChild(li);
            }
          }
        }
      } else {
        const img = new Image();
        img.src = `wolf/${name}.png`;
        img.alt = '';
        el.appendChild(img);
      }
      poses[name] = el;
      body.appendChild(el);
    }
    root.replaceChildren(body, fx);
    return poses;
  }

  function mount(root, { variant = 'mini', sleepAfter = 3 * 60 * 1000 } = {}) {
    let poses = {};
    let state = 'idle', pose = 'idle', asleep = false;
    let backTimer = null, sleepTimer = null, drowsyTimer = null, lifeTimer = null, blinkTimer = null;
    let listening = false;

    const show = (name) => {
      if (!poses[name]) name = 'idle';
      pose = name;
      root.dataset.pose = name;
      for (const [n, el] of Object.entries(poses)) el.classList.toggle('on', n === name);
      tilt(0);
    };

    const tilt = (deg) => {
      const el = poses[pose];
      el?.querySelectorAll('.p-head').forEach((h) => { h.style.transform = deg ? `rotate(${deg}deg)` : ''; });
    };

    // battito di ciglia: solo nelle pose che hanno le palpebre
    const blink = () => {
      clearTimeout(blinkTimer);
      const hasLids = poses[pose]?.querySelector('.lids');
      if (hasLids && !asleep && !reduced) {
        root.classList.add('blink');
        setTimeout(() => root.classList.remove('blink'), 120);
        if (Math.random() < 0.2) setTimeout(() => { root.classList.add('blink'); setTimeout(() => root.classList.remove('blink'), 110); }, 260);
      }
      blinkTimer = setTimeout(blink, rnd(2400, 6200));
    };

    // piccoli gesti quando non ha niente da fare
    const life = () => {
      clearTimeout(lifeTimer);
      if (!reduced && state === 'idle' && !asleep) {
        const r = Math.random();
        if (r < 0.45) { tilt(rnd(-3, 3)); setTimeout(() => tilt(0), rnd(1400, 2600)); }
        else if (r < 0.65 && pose === 'idle') wave();
      }
      lifeTimer = setTimeout(life, rnd(5000, 10000));
    };

    const wave = () => {
      root.classList.remove('waving');
      void root.offsetWidth; // riavvia l'animazione
      root.classList.add('waving');
      setTimeout(() => root.classList.remove('waving'), 1800);
    };

    const armSleep = () => {
      clearTimeout(sleepTimer); clearTimeout(drowsyTimer);
      if (!sleepAfter || reduced) return;
      drowsyTimer = setTimeout(() => { if (state === 'idle') root.classList.add('drowsy'); }, Math.max(0, sleepAfter - 12000));
      sleepTimer = setTimeout(() => {
        if (state !== 'idle') return;
        root.classList.remove('drowsy');
        asleep = true;
        root.dataset.state = 'sleeping';
        show('sleeping');
      }, sleepAfter);
    };

    function apply(next, opts = {}) {
      clearTimeout(backTimer);
      root.classList.remove('drowsy');
      state = next;
      root.dataset.state = next;
      show(listening && next === 'idle' ? 'listening' : poseFor(next, opts));
      if (TRANSIENT[next]) backTimer = setTimeout(() => apply('idle'), TRANSIENT[next]);
      if (next === 'idle') armSleep(); else { clearTimeout(sleepTimer); clearTimeout(drowsyTimer); }
    }

    function set(next, opts = {}) {
      if (!manifest) { ready.then(() => set(next, opts)); return; }
      // svegliarlo: prima uno sbadiglio, poi quello che deve fare
      if (asleep && next !== 'idle' && next !== 'sleeping') {
        asleep = false;
        apply('yawning');
        clearTimeout(backTimer);
        backTimer = setTimeout(() => apply(next, opts), 1300);
        return;
      }
      if (asleep && next === 'idle') return; // resta a dormire
      if (next === state && next !== 'tool' && !TRANSIENT[next]) return;
      apply(next, opts);
    }

    ready.then(() => {
      poses = build(root, variant);
      apply('idle');
      blinkTimer = setTimeout(blink, 1500);
      lifeTimer = setTimeout(life, 4000);
    });

    return {
      set,
      get state() { return asleep ? 'sleeping' : state; },
      hello() { set('hello'); },
      wake() { if (asleep) set('hello'); },
      wave() { if (!asleep && state === 'idle') { if (pose === 'idle') wave(); else set('hello'); } },
      listen(on) {
        listening = !!on;
        if (asleep && on) { set('hello'); return; }
        if (state === 'idle' && !asleep) show(on ? 'listening' : 'idle');
        if (on) armSleep();
      },
    };
  }

  window.HowlWolf = { mount, poseFor };
})();
