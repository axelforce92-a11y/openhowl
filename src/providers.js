// Livello provider: un'unica funzione chat() che parla con Anthropic o con qualsiasi API
// compatibile OpenAI (DeepSeek, OpenAI, OpenRouter, Ollama). Formato interno = blocchi stile Anthropic.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function* sseData(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

async function post(url, headers, body, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 4) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    throw new Error(`API ${res.status}: ${text.slice(0, 600)}`);
  }
}

export async function chat(p, opts) {
  if (!p.apiKey) throw new Error(`Manca la chiave API: imposta ${p.keyEnv} nel file .env di OpenHowl (o aggiungi un cervello dal pannello 🧠).`);
  return p.kind === 'anthropic' ? anthropicChat(p, opts) : openaiChat(p, opts);
}

/* ───────────────────────── Anthropic ───────────────────────── */

async function anthropicChat(p, { system, messages, tools = [], signal, onDelta = () => {}, maxTokens = 16000, thinkingBudget = 0 }) {
  // Blocchi "thinking" senza firma (es. generati da un altro provider) non sono accettati: li scartiamo.
  const msgs = messages.map((m) =>
    typeof m.content === 'string' ? m : { ...m, content: m.content.filter((b) => b.type !== 'thinking' || b.signature) },
  ).filter((m) => typeof m.content === 'string' || m.content.length);
  // Prompt caching sull'ultimo messaggio: il prefisso della conversazione viene riusato a basso costo.
  const last = msgs.at(-1);
  if (last) {
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
    blocks[blocks.length - 1] = { ...blocks.at(-1), cache_control: { type: 'ephemeral' } };
    msgs[msgs.length - 1] = { ...last, content: blocks };
  }
  const body = {
    model: p.model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: msgs,
    stream: true,
  };
  if (tools.length) body.tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  if (thinkingBudget >= 1024 && maxTokens > thinkingBudget + 1000) body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };

  const res = await post(`${p.baseUrl}/v1/messages`, { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }, body, signal);
  const blocks = [];
  let stop = 'end_turn';
  const usage = { input: 0, output: 0 };
  for await (const raw of sseData(res)) {
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message.usage || {};
        usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        break;
      }
      case 'content_block_start':
        blocks[ev.index] = { ...ev.content_block };
        if (ev.content_block.type === 'tool_use') blocks[ev.index]._json = '';
        break;
      case 'content_block_delta': {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text += d.text; onDelta({ type: 'text', text: d.text }); }
        else if (d.type === 'thinking_delta') { b.thinking += d.thinking; onDelta({ type: 'thinking', text: d.thinking }); }
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') b._json += d.partial_json;
        break;
      }
      case 'content_block_stop': {
        const b = blocks[ev.index];
        if (b?.type === 'tool_use') {
          try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; }
          delete b._json;
        }
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        if (ev.usage?.output_tokens) usage.output = ev.usage.output_tokens;
        break;
      case 'error':
        throw new Error(`API stream: ${ev.error?.message || raw}`);
    }
  }
  return { content: blocks.filter(Boolean), stop_reason: stop, usage };
}

/* ─────────────────────── OpenAI-compatible ─────────────────────── */

function thinkSplitter(onText, onThink) {
  let buf = '', inThink = false;
  const emit = (s) => s && (inThink ? onThink : onText)(s);
  return {
    push(s) {
      buf += s;
      for (;;) {
        const tag = inThink ? '</think>' : '<think>';
        const i = buf.indexOf(tag);
        if (i >= 0) { emit(buf.slice(0, i)); buf = buf.slice(i + tag.length); inThink = !inThink; continue; }
        let keep = 0; // trattiene un possibile tag spezzato tra due chunk
        for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) if (tag.startsWith(buf.slice(-k))) { keep = k; break; }
        emit(buf.slice(0, buf.length - keep));
        buf = buf.slice(buf.length - keep);
        return;
      }
    },
    flush() { emit(buf); buf = ''; },
  };
}

// Elenca i modelli disponibili su un endpoint (per il gestore Cervelli).
export async function listModels({ kind = 'openai', baseUrl, apiKey }) {
  const base = String(baseUrl).replace(/\/$/, '');
  const res = kind === 'anthropic'
    ? await fetch(`${base}/v1/models`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(8000) })
    : await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter((id) => id && !/embed/i.test(id));
}

// Cerca server di modelli locali attivi sul PC.
export async function detectLocal() {
  const servers = [
    ['LM Studio', 'http://127.0.0.1:1234/v1'], ['Ollama', 'http://127.0.0.1:11434/v1'],
    ['vLLM', 'http://127.0.0.1:8000/v1'], ['llama.cpp', 'http://127.0.0.1:8080/v1'], ['Jan', 'http://127.0.0.1:1337/v1'],
  ];
  const found = await Promise.all(servers.map(async ([name, baseUrl]) => {
    try { return { name, baseUrl, models: await listModels({ baseUrl }) }; } catch { return null; }
  }));
  return found.filter((f) => f?.models.length);
}

function toOpenAIMessages(system, messages, p) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') };
      const calls = m.content.filter((b) => b.type === 'tool_use');
      if (calls.length) msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } }));
      const reasoning = m.content.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('');
      if (reasoning && p.echoReasoning) msg.reasoning_content = reasoning;
      out.push(msg);
      continue;
    }
    const texts = [], images = [];
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : b.content || [];
        parts.filter((x) => x.type === 'image').forEach((x) => images.push(x));
        const t = parts.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'ERRORE: ' : '') + (t || '(ok)') });
      } else if (b.type === 'text') texts.push(b.text);
      else if (b.type === 'image') images.push(b);
    }
    if (!texts.length && !images.length) continue;
    if (images.length && p.vision) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: texts.join('\n') || 'Immagini allegate dagli strumenti:' },
          ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.source.media_type};base64,${im.source.data}` } })),
        ],
      });
    } else {
      out.push({ role: 'user', content: texts.join('\n') + (images.length ? '\n[immagine omessa: il modello attuale non supporta la visione]' : '') });
    }
  }
  return out;
}

async function openaiChat(p, { system, messages, tools = [], signal, onDelta = () => {}, maxTokens = 16000 }) {
  const body = {
    model: p.model,
    messages: toOpenAIMessages(system, messages, p),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
  };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

  const res = await post(`${p.baseUrl}/chat/completions`, { authorization: `Bearer ${p.apiKey}` }, body, signal);
  let text = '', reasoning = '', finish = null;
  const calls = [];
  const usage = { input: 0, output: 0 };
  // Molti modelli locali (Qwen, DeepSeek-R1…) mettono il ragionamento tra <think> nel testo: lo separiamo al volo.
  const split = thinkSplitter(
    (t) => { text += t; onDelta({ type: 'text', text: t }); },
    (t) => { reasoning += t; onDelta({ type: 'thinking', text: t }); },
  );
  for await (const raw of sseData(res)) {
    if (raw === '[DONE]') break;
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    if (j.error) throw new Error(`API: ${j.error.message || JSON.stringify(j.error)}`);
    if (j.usage) { usage.input = j.usage.prompt_tokens || 0; usage.output = j.usage.completion_tokens || 0; }
    const ch = j.choices?.[0];
    if (!ch) continue;
    const d = ch.delta || {};
    if (d.content) split.push(d.content);
    const r = d.reasoning_content || d.reasoning;
    if (typeof r === 'string' && r) { reasoning += r; onDelta({ type: 'thinking', text: r }); }
    for (const tc of d.tool_calls || []) {
      const c = (calls[tc.index ?? calls.length] ??= { id: '', name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      const a = tc.function?.arguments;
      if (a) c.args += typeof a === 'string' ? a : JSON.stringify(a);
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  }
  split.flush();
  // Template Qwen senza tag di apertura: tutto ciò che precede </think> è ragionamento.
  if (text.includes('</think>')) {
    const i = text.lastIndexOf('</think>');
    reasoning += text.slice(0, i).replace(/<think>/g, '');
    text = text.slice(i + 8);
  }
  // Chiamate a strumenti scritte come testo (<tool_call>{...}</tool_call>) quando il server non le converte.
  if (!calls.length && text.includes('<tool_call>')) {
    text = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, body) => {
      try {
        const t = JSON.parse(body);
        calls.push({ id: '', name: t.name, args: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments || t.parameters || {}) });
        return '';
      } catch { return m; }
    });
  }
  text = text.trim();
  const content = [];
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning });
  if (text) content.push({ type: 'text', text });
  calls.filter(Boolean).forEach((c, i) => {
    let input;
    try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { _raw: c.args }; }
    content.push({ type: 'tool_use', id: c.id || `call_${Date.now()}_${i}`, name: c.name, input });
  });
  const stop = calls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
  return { content, stop_reason: stop, usage };
}
