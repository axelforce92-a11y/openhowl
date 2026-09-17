// Web: ricerca (Brave API se disponibile, altrimenti DuckDuckGo senza chiave) e lettura pagine.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì' };
export const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

export function htmlToText(html, baseUrl) {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, l) => `\n\n${'#'.repeat(+l)} `)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|pre|blockquote|header|main)>/gi, '\n')
    .replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const t = inner.replace(/<[^>]+>/g, '').trim();
      if (!t) return '';
      try { return `[${t}](${new URL(decode(href), baseUrl).href})`; } catch { return t; }
    })
    .replace(/<[^>]+>/g, ' ');
  return decode(s).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function ddg(query, max) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query, kl: 'it-it' }),
  });
  const html = await res.text();
  const results = [];
  for (const block of html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)) {
    const a = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a || /result--ad/.test(block.slice(0, 200))) continue;
    const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
    let url = decode(a[1]);
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    results.push({ title: decode(a[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: decode((sn?.[1] || '').replace(/<[^>]+>/g, '')).trim() });
    if (results.length >= max) break;
  }
  return results;
}

async function bing(query, max) {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it`, { headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9,en;q=0.8' } });
  const html = await res.text();
  const results = [];
  for (const block of html.split('<li class="b_algo"').slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    let url = decode(a[1]);
    const enc = url.match(/[?&]u=a1([^&]+)/); // link di tracciamento Bing con URL in base64
    if (enc) { try { url = Buffer.from(enc[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch {} }
    results.push({ title: decode(a[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: decode((p?.[1] || '').replace(/<[^>]+>/g, '')).trim() });
    if (results.length >= max) break;
  }
  return results;
}

async function brave(query, max) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`, {
    headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = await res.json();
  return (j.web?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.description || '').replace(/<[^>]+>/g, '') }));
}

export const webTools = [
  {
    name: 'web_search',
    description: 'Cerca sul web e restituisce titoli, URL e snippet. Poi usa web_fetch per leggere le pagine rilevanti.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] },
    risk: 'read',
    async run({ query, max_results = 8 }) {
      // Catena di motori: Brave (se c'è la chiave) → DuckDuckGo → Bing
      const engines = [...(process.env.BRAVE_API_KEY ? [brave] : []), ddg, bing];
      let results = [], errors = [];
      for (const engine of engines) {
        try { results = await engine(query, max_results); } catch (e) { errors.push(`${engine.name}: ${e.message}`); }
        if (results.length) break;
      }
      if (!results.length && errors.length) throw new Error(`Ricerca fallita (${errors.join('; ')})`);
      if (!results.length) return 'Nessun risultato (il motore potrebbe aver bloccato la richiesta). Prova con il tool browser su un motore di ricerca.';
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
    },
  },
  {
    name: 'web_fetch',
    description: 'Scarica una pagina web e la restituisce come testo leggibile (con link). Per pagine che richiedono JavaScript o interazione usa browser.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer' } }, required: ['url'] },
    risk: 'read',
    async run({ url, max_chars = 25000 }, ctx) {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain,*/*' }, redirect: 'follow', signal: ctx.signal });
      const type = res.headers.get('content-type') || '';
      if (/image\/(png|jpeg|gif|webp)/.test(type)) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { text: `${res.url} (${type})`, images: [{ media_type: type.split(';')[0], data: buf.toString('base64') }] };
      }
      const body = await res.text();
      let text = body, title = '';
      if (/html/.test(type) || /^\s*</.test(body)) {
        title = decode(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
        text = htmlToText(body, res.url);
      }
      const clipped = text.length > max_chars ? text.slice(0, max_chars) + `\n\n… [troncato: ${text.length} caratteri totali]` : text;
      return `URL: ${res.url}\nStato: ${res.status}${title ? `\nTitolo: ${title}` : ''}\n\n${clipped}`;
    },
  },
];
