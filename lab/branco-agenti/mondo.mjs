// Il mondo della simulazione: lo sportello di "LupoCasa", un piccolo regolamento di affitti (inventato)
// con penali, tetti massimi ed eccezioni. Le risposte giuste sono CALCOLATE qui dal codice, non scritte a mano.

export const ARTICOLI = {
  1: ['Canone', 'Il canone mensile è quello indicato nella scheda del cliente.'],
  2: ['Ritardo nei pagamenti', 'Per il pagamento in ritardo del canone si applica una penale del 2% del canone mensile per ogni giorno di ritardo. I primi 5 giorni di ritardo sono di tolleranza e non si contano.'],
  3: ['Tetto alla penale', 'La penale per ritardo, calcolata secondo l\'art. 2, non può in nessun caso superare il 30% del canone mensile.'],
  4: ['Inquilini storici', 'Agli inquilini con anzianità di almeno 5 anni la penale per ritardo è dimezzata. La riduzione si applica dopo il tetto dell\'art. 3.'],
  5: ['Deposito cauzionale', 'Il deposito cauzionale è pari a 2 mensilità di canone. Alla fine del contratto viene restituito al netto dei danni documentati.'],
  6: ['Contratti brevi', 'Se il contratto termina prima di 12 mesi di durata, oltre ai danni viene trattenuto anche il 10% del deposito cauzionale.'],
  7: ['Recesso', 'L\'inquilino può recedere con un preavviso di 3 mesi. Se il preavviso è più breve, deve pagare il canone per ciascun mese di preavviso mancante.'],
  8: ['Animali', 'È previsto un supplemento di 15 euro al mese per ogni animale. I cani di taglia grande contano come due animali.'],
  9: ['Pagamenti anticipati', 'Chi paga 12 mesi di canone in anticipo ottiene uno sconto del 4% sul totale annuo. Lo sconto non si applica ai supplementi.'],
};

export const CLIENTI = {
  rossi: { nome: 'Mario Rossi', canone: 800, anzianita: 6, durata: 30, animali: [{ tipo: 'cane', taglia: 'grande' }] },
  bianchi: { nome: 'Lucia Bianchi', canone: 650, anzianita: 2, durata: 20, animali: [] },
  verdi: { nome: 'Paolo Verdi', canone: 1200, anzianita: 1, durata: 8, animali: [{ tipo: 'gatto' }] },
  neri: { nome: 'Anna Neri', canone: 900, anzianita: 5, durata: 64, animali: [{ tipo: 'gatto' }, { tipo: 'cane', taglia: 'piccola' }] },
  gallo: { nome: 'Sara Gallo', canone: 1000, anzianita: 3, durata: 40, animali: [{ tipo: 'cane', taglia: 'grande' }, { tipo: 'gatto' }] },
};

const scheda = (id) => {
  const c = CLIENTI[id];
  const an = c.animali.length ? c.animali.map((a) => `${a.tipo}${a.taglia ? ` di taglia ${a.taglia}` : ''}`).join(', ') : 'nessuno';
  return `Cliente: ${c.nome}\nCanone mensile: ${c.canone} euro\nAnzianità: ${c.anzianita} anni\nDurata del contratto finora: ${c.durata} mesi\nAnimali: ${an}`;
};

/* ── regole vere, in codice ── */
const penale = (c, giorni) => {
  let p = Math.max(0, giorni - 5) * 0.02 * c.canone;
  p = Math.min(p, 0.3 * c.canone);
  if (c.anzianita >= 5) p /= 2;
  return p;
};
const deposito = (c, danni) => 2 * c.canone - danni - (c.durata < 12 ? 0.1 * 2 * c.canone : 0);
const recesso = (c, preavviso) => Math.max(0, 3 - preavviso) * c.canone;
const unitaAnimali = (c) => c.animali.reduce((n, a) => n + (a.tipo === 'cane' && a.taglia === 'grande' ? 2 : 1), 0);
const annoAnticipato = (c) => 12 * c.canone * 0.96 + 12 * 15 * unitaAnimali(c);

// Esame (selezione) ed esame segreto (mai usato per scegliere né per imparare).
const T = (id, domanda, risposta) => ({ id, domanda, risposta: Math.round(risposta * 100) / 100 });
const C = CLIENTI;
export const ESAME = [
  T('E1', 'Mario Rossi ha pagato il canone con 9 giorni di ritardo. Quanto deve di penale?', penale(C.rossi, 9)),
  T('E2', 'Lucia Bianchi ha pagato il canone con 20 giorni di ritardo. Quanto deve di penale?', penale(C.bianchi, 20)),
  T('E3', 'Paolo Verdi lascia l\'appartamento adesso, con 150 euro di danni documentati. Quanto gli viene restituito del deposito?', deposito(C.verdi, 150)),
  T('E4', 'Lucia Bianchi vuole recedere dal contratto dando solo 1 mese di preavviso. Quanto deve pagare per il preavviso mancante?', recesso(C.bianchi, 1)),
  T('E5', 'Quanto paga Mario Rossi di supplemento animali in un anno?', 12 * 15 * unitaAnimali(C.rossi)),
  T('E6', 'Anna Neri ha pagato il canone con 30 giorni di ritardo. Quanto deve di penale?', penale(C.neri, 30)),
];
export const SEGRETO = [
  T('S1', 'Sara Gallo vuole pagare in anticipo tutto l\'anno, canone e supplemento animali compresi. Quanto paga in totale?', annoAnticipato(C.gallo)),
  T('S2', 'Paolo Verdi ha pagato il canone con 7 giorni di ritardo. Quanto deve di penale?', penale(C.verdi, 7)),
  T('S3', 'Mario Rossi lascia l\'appartamento senza danni. Quanto gli viene restituito del deposito?', deposito(C.rossi, 0)),
  T('S4', 'Sara Gallo ha pagato il canone con 25 giorni di ritardo. Quanto deve di penale?', penale(C.gallo, 25)),
];

/* ── strumenti dell'agente ── */
export const TOOLS = [
  { type: 'function', function: { name: 'indice', description: 'Elenco degli articoli del regolamento LupoCasa (numero e titolo).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'leggi_articolo', description: 'Testo completo di un articolo del regolamento.', parameters: { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'] } } },
  { type: 'function', function: { name: 'scheda_cliente', description: 'Dati del cliente: canone, anzianità, durata del contratto, animali. Passa il cognome.', parameters: { type: 'object', properties: { cognome: { type: 'string' } }, required: ['cognome'] } } },
  { type: 'function', function: { name: 'calcola', description: 'Calcolatrice: valuta un\'espressione aritmetica, es. "(12-5)*0.02*800".', parameters: { type: 'object', properties: { espressione: { type: 'string' } }, required: ['espressione'] } } },
];

export function runTool(name, args = {}) {
  switch (name) {
    case 'indice': return Object.entries(ARTICOLI).map(([n, [t]]) => `Art. ${n} — ${t}`).join('\n');
    case 'leggi_articolo': {
      const a = ARTICOLI[Number(args.numero)];
      return a ? `Art. ${args.numero} — ${a[0]}\n${a[1]}` : 'Articolo inesistente.';
    }
    case 'scheda_cliente': {
      const k = String(args.cognome || '').toLowerCase().split(/\s+/).pop();
      return CLIENTI[k] ? scheda(k) : 'Cliente non trovato.';
    }
    case 'calcola': {
      const e = String(args.espressione || '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/%/g, '/100');
      if (!/^[\d\s.+\-*/()]+$/.test(e)) return 'Espressione non valida: usa solo numeri e + - * / ( ).';
      try { const v = Function(`"use strict";return (${e})`)(); return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : 'Risultato non valido.'; } catch { return 'Espressione non valida.'; }
    }
    default: return 'Strumento sconosciuto.';
  }
}
