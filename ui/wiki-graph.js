// Grafo neurale della LLM Wiki: force layout 2D/3D, profondità e impulsi direzionali.
(() => {
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const hash = (value) => {
    let h = 2166136261;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const seeded = (seed) => {
    let x = seed || 1;
    return () => ((x = Math.imul(1664525, x) + 1013904223 >>> 0) / 4294967296);
  };
  const hexRgb = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, value >> 8 & 255, value & 255];
  };

  class NeuralWikiGraph {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.options = options;
      this.colors = options.colors || {};
      this.nodes = [];
      this.edges = [];
      this.projected = [];
      this.mode = '2d';
      this.motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.rotation = { x: -0.22, y: 0.45 };
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.drag = null;
      this.hovered = null;
      this.selected = null;
      this.last = performance.now();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.bind();
      this.resize();
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    bind() {
      this.canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.canvas.setPointerCapture(event.pointerId);
        const pan = this.mode === '2d' || event.button === 1 || event.button === 2 || event.shiftKey || event.ctrlKey;
        this.drag = { x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, moved: false, action: pan ? 'pan' : 'orbit' };
      });
      this.canvas.addEventListener('pointermove', (event) => {
        if (this.drag) {
          const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
          this.drag.x = event.clientX; this.drag.y = event.clientY;
          if (Math.abs(event.clientX - this.drag.sx) + Math.abs(event.clientY - this.drag.sy) > 4) this.drag.moved = true;
          if (this.drag.action === 'orbit') {
            this.rotation.y += dx * .008;
            this.rotation.x = clamp(this.rotation.x + dy * .006, -1.3, 1.3);
          } else {
            this.pan.x += dx;
            this.pan.y += dy;
          }
          return;
        }
        this.pick(event);
      });
      this.canvas.addEventListener('pointerup', (event) => {
        const moved = this.drag?.moved;
        this.drag = null;
        if (!moved) {
          const node = this.pick(event);
          if (node) { this.selected = node.id; this.options.onSelect?.(node.id); }
        }
      });
      this.canvas.addEventListener('pointerleave', () => {
        if (!this.drag) { this.hovered = null; this.options.onHover?.(null); }
      });
      this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
      this.canvas.addEventListener('dblclick', () => this.resetView());
      this.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * .001), .45, 3.2);
      }, { passive: false });
      this.canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && this.hovered) this.options.onSelect?.(this.hovered.id);
        if (this.mode === '3d' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'ArrowLeft') this.rotation.y -= .1;
          if (event.key === 'ArrowRight') this.rotation.y += .1;
          if (event.key === 'ArrowUp') this.rotation.x -= .1;
          if (event.key === 'ArrowDown') this.rotation.x += .1;
        }
      });
    }

    resize() {
      const box = this.canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.width = Math.max(1, box.width);
      this.height = Math.max(1, box.height);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setMode(mode) {
      this.mode = mode === '3d' ? '3d' : '2d';
      this.canvas.classList.toggle('is-3d', this.mode === '3d');
      this.pan = { x: 0, y: 0 };
      this.zoom = 1;
    }

    setMotion(enabled) { this.motion = !!enabled; }
    select(id) { this.selected = id; }
    resetView() {
      this.rotation = { x: -0.22, y: 0.45 };
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
    }

    setData(notes = [], edges = []) {
      const old = new Map(this.nodes.map((node) => [node.id, node]));
      this.nodes = notes.map((note, index) => {
        const previous = old.get(note.id);
        const random = seeded(hash(note.id));
        return {
          ...note,
          x: previous?.x ?? (random() - .5) * 280,
          y: previous?.y ?? (random() - .5) * 220,
          z: previous?.z ?? (random() - .5) * 250,
          vx: 0, vy: 0, vz: 0,
          degree: 0,
          index,
        };
      });
      const byId = new Map(this.nodes.map((node) => [node.id, node]));
      this.edges = edges.map((edge) => ({ a: byId.get(edge.source), b: byId.get(edge.target) })).filter((edge) => edge.a && edge.b);
      for (const edge of this.edges) { edge.a.degree++; edge.b.degree++; }
      this.relax();
      this.spread = Math.max(80, ...this.nodes.map((item) => Math.hypot(item.x, item.y)));
      const ranked = [...this.edges].sort((a, b) => Math.max(b.a.degree, b.b.degree) - Math.max(a.a.degree, a.b.degree));
      const count = Math.min(90, ranked.length);
      this.signals = ranked.slice(0, count).map((edge, index) => ({
        edge,
        t: (index * .61803398875) % 1,
        speed: .075 + (index % 5) * .011,
        length: .16 + (index % 4) * .025,
      }));
    }

    relax() {
      const nodes = this.nodes, edges = this.edges;
      if (!nodes.length) return;
      const iterations = nodes.length > 250 ? 90 : nodes.length > 100 ? 140 : 230;
      for (let step = 0; step < iterations; step++) {
        const stride = nodes.length > 180 ? Math.ceil(nodes.length / 28) : 1;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j += stride) {
            const a = nodes[i], b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            const d2 = dx * dx + dy * dy + dz * dz + 20;
            const force = Math.min(.8, 900 / d2);
            a.vx += dx * force; a.vy += dy * force; a.vz += dz * force;
            b.vx -= dx * force; b.vy -= dy * force; b.vz -= dz * force;
          }
        }
        for (const edge of edges) {
          const { a, b } = edge;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const force = (distance - 92) * .006;
          a.vx += dx / distance * force; a.vy += dy / distance * force; a.vz += dz / distance * force;
          b.vx -= dx / distance * force; b.vy -= dy / distance * force; b.vz -= dz / distance * force;
        }
        for (const node of nodes) {
          node.vx += -node.x * .002; node.vy += -node.y * .002; node.vz += -node.z * .0015;
          node.vx *= .72; node.vy *= .72; node.vz *= .72;
          node.x += node.vx; node.y += node.vy; node.z += node.vz;
        }
      }
    }

    project(node) {
      const base = Math.min(this.width, this.height) * .39 / (this.spread || 80) * this.zoom;
      if (this.mode === '2d') return { x: this.width / 2 + node.x * base + this.pan.x, y: this.height / 2 + node.y * base + this.pan.y, z: 0, scale: base };
      const cy = Math.cos(this.rotation.y), sy = Math.sin(this.rotation.y);
      const cx = Math.cos(this.rotation.x), sx = Math.sin(this.rotation.x);
      const rx = node.x * cy - node.z * sy;
      const rz0 = node.x * sy + node.z * cy;
      const ry = node.y * cx - rz0 * sx;
      const rz = node.y * sx + rz0 * cx;
      const perspective = clamp(620 / (620 + rz * base), .45, 2.2);
      return { x: this.width / 2 + rx * base * perspective + this.pan.x, y: this.height / 2 + ry * base * perspective + this.pan.y, z: rz, scale: base * perspective };
    }

    pick(event) {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      let best = null, distance = Infinity;
      for (const point of this.projected) {
        const d = Math.hypot(point.x - x, point.y - y);
        if (d < point.radius + 10 && d < distance) { best = point.node; distance = d; }
      }
      if (best?.id !== this.hovered?.id) {
        this.hovered = best;
        this.canvas.style.cursor = best ? 'pointer' : this.mode === '3d' ? 'grab' : 'move';
        this.options.onHover?.(best, { x, y });
      }
      return best;
    }

    frame(now) {
      requestAnimationFrame(this.frame);
      if (!this.canvas.offsetParent || !this.width || !this.height) return;
      const box = this.canvas.getBoundingClientRect();
      if (Math.abs(box.width - this.width) > 1 || Math.abs(box.height - this.height) > 1) this.resize();
      const dt = Math.min(.05, (now - this.last) / 1000 || .016);
      this.last = now;
      if (this.mode === '3d' && this.motion && !this.drag) this.rotation.y += dt * .075;
      this.draw(now, dt);
    }

    draw(now, dt) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      if (!this.nodes.length) return;
      const projectedMap = new Map();
      this.projected = this.nodes.map((node) => {
        const point = this.project(node);
        projectedMap.set(node.id, point);
        return { ...point, node, radius: clamp(4.2 + Math.sqrt(node.degree + 1) * 2.2, 5, 15) * (this.mode === '3d' ? clamp(point.scale / 2.2, .65, 1.45) : 1) };
      });
      const depth = this.projected.map((point) => point.z);
      const zMin = Math.min(...depth), zMax = Math.max(...depth), zSpan = zMax - zMin || 1;

      ctx.lineCap = 'round';
      for (const edge of this.edges) {
        const a = projectedMap.get(edge.a.id), b = projectedMap.get(edge.b.id);
        const d = this.mode === '3d' ? (((a.z + b.z) / 2 - zMin) / zSpan) : .6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(103, 158, 226, ${.18 + d * .28})`;
        ctx.lineWidth = .7 + d * 1.05;
        ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(75,165,255,.32)'; ctx.stroke();
      }
      ctx.shadowBlur = 0;

      if (this.motion) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const signal of this.signals || []) {
          signal.t = (signal.t + dt * signal.speed * (1 + Math.max(signal.edge.a.degree, signal.edge.b.degree) * .035)) % 1;
          const highA = signal.edge.a.degree >= signal.edge.b.degree;
          const start = projectedMap.get(highA ? signal.edge.a.id : signal.edge.b.id);
          const end = projectedMap.get(highA ? signal.edge.b.id : signal.edge.a.id);
          const headT = signal.t;
          const tailT = Math.max(0, headT - signal.length);
          const tailX = start.x + (end.x - start.x) * tailT;
          const tailY = start.y + (end.y - start.y) * tailT;
          const headX = start.x + (end.x - start.x) * headT;
          const headY = start.y + (end.y - start.y) * headT;
          const glow = ctx.createLinearGradient(tailX, tailY, headX, headY);
          glow.addColorStop(0, 'rgba(55, 147, 255, 0)');
          glow.addColorStop(.42, 'rgba(68, 184, 255, .28)');
          glow.addColorStop(.82, 'rgba(108, 225, 255, .86)');
          glow.addColorStop(1, 'rgba(239, 253, 255, 1)');
          const depthScale = this.mode === '3d' ? clamp((start.scale + end.scale) / 4, .72, 1.35) : 1;

          ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(headX, headY);
          ctx.strokeStyle = glow; ctx.lineWidth = 6.5 * depthScale;
          ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(75, 211, 255, .92)'; ctx.stroke();

          ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(headX, headY);
          ctx.strokeStyle = glow; ctx.lineWidth = 1.65 * depthScale;
          ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(225, 251, 255, 1)'; ctx.stroke();
        }
        ctx.restore();
      }

      const ordered = [...this.projected].sort((a, b) => a.z - b.z);
      const maxDegree = Math.max(1, ...this.nodes.map((node) => node.degree));
      const dense = this.nodes.length > 220;
      for (const point of ordered) {
        const node = point.node, selected = node.id === this.selected, hovered = node.id === this.hovered?.id;
        const relevance = node.degree / maxDegree;
        const pulse = this.motion ? Math.sin(now * .0022 + node.index * 1.71) * .55 + .45 : .25;
        const radius = point.radius + (selected ? 3 : hovered ? 2 : pulse * (1 + relevance));
        const color = this.colors[node.type] || this.colors.concept || '#69a9ff';
        const [r, g, b] = hexRgb(color);
        if (!dense || selected || hovered || relevance > .45) {
          const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3.6);
          halo.addColorStop(0, `rgba(${r},${g},${b},.42)`);
          halo.addColorStop(.32, `rgba(${r},${g},${b},.16)`);
          halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath(); ctx.arc(point.x, point.y, radius * 3.6, 0, TAU); ctx.fillStyle = halo; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, TAU);
        ctx.fillStyle = color; ctx.shadowBlur = dense ? 5 + relevance * 8 : 12 + relevance * 15; ctx.shadowColor = color; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(point.x - radius * .25, point.y - radius * .3, Math.max(1.2, radius * .2), 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fill();
        if (selected) {
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 5, 0, TAU);
          ctx.strokeStyle = 'rgba(222,245,255,.78)'; ctx.lineWidth = 1.4; ctx.stroke();
        }
        const showLabel = this.nodes.length < 70 || hovered || selected || relevance > .55;
        if (showLabel) {
          ctx.font = `${hovered || selected ? 600 : 500} 10px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,10,23,.88)';
          const label = node.title.length > 28 ? node.title.slice(0, 26) + '…' : node.title;
          ctx.strokeText(label, point.x, point.y + radius + 7);
          ctx.fillStyle = hovered || selected ? '#eef7ff' : 'rgba(174,193,226,.78)';
          ctx.fillText(label, point.x, point.y + radius + 7);
        }
      }
      ctx.shadowBlur = 0;
      if (this.mode === '3d') this.drawAxes(ctx);
    }

    drawAxes(ctx) {
      const origin = { x: this.width - 48, y: this.height - 48 };
      const cy = Math.cos(this.rotation.y), sy = Math.sin(this.rotation.y);
      const cx = Math.cos(this.rotation.x), sx = Math.sin(this.rotation.x);
      const axes = [
        { label: 'X', color: '#ff7189', vector: [1, 0, 0] },
        { label: 'Y', color: '#72e3ab', vector: [0, 1, 0] },
        { label: 'Z', color: '#72b7ff', vector: [0, 0, 1] },
      ];
      ctx.save(); ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const axis of axes) {
        const [x, y, z] = axis.vector;
        const rx = x * cy - z * sy, rz0 = x * sy + z * cy;
        const ry = y * cx - rz0 * sx;
        const end = { x: origin.x + rx * 22, y: origin.y + ry * 22 };
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = axis.color; ctx.lineWidth = 1.4; ctx.shadowBlur = 5; ctx.shadowColor = axis.color; ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = axis.color; ctx.fillText(axis.label, end.x, end.y);
      }
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 2.4, 0, TAU); ctx.fillStyle = '#d9efff'; ctx.fill(); ctx.restore();
    }
  }

  window.createNeuralWikiGraph = (canvas, options) => new NeuralWikiGraph(canvas, options);
})();
