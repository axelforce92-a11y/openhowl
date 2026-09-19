"""Branco nano — evoluzione di modelli in miniatura (solo numpy, gira in pochi secondi sul processore).

La stessa idea che useremo con Qwen, ma con reti neurali da ~17 mila parametri:

  1. ANTENATO   una rete addestrata poco su tutto: sa "un po' di tutto" (come il modello base).
  2. PCR        dall'antenato nascono i fondatori: ognuno viene addestrato su UNA materia (il "primer").
  3. BRANCO     i migliori si accoppiano: i figli nascono FONDENDO i pesi dei genitori (niente addestramento),
                a volte con una piccola mutazione (un breve ripasso della materia in cui sono più deboli).
  4. SELEZIONE  ogni figlio fa l'esame; solo i migliori diventano genitori della generazione dopo.

Le "materie" sono 4 domande su due numeri da 0 a 15 (massimo, minimo, confronto, vicinanza): 1024 fatti in tutto. L'esame segreto usa fatti che nessuno ha mai visto in addestramento.

Uso:  python branco.py [--seed 3] [--gen 8]      → scrive risultati.json e albero.html qui accanto
"""
import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

N = 16
# materie scelte perché una rete piccola può capirne la REGOLA (non solo impararle a memoria):
# così l'esame segreto, su coppie mai viste, misura se ha capito davvero
SKILLS = {
    'massimo': lambda a, b: max(a, b),
    'minimo': lambda a, b: min(a, b),
    'confronto': lambda a, b: int(a > b),             # 1 se il primo è più grande
    'vicinanza': lambda a, b: int(abs(a - b) <= 2),   # 1 se distano al massimo 2
}
OUT = N  # risposte possibili: da 0 a 15
NAMES = list(SKILLS)
HIDDEN = 96

NOMI = ['Luna', 'Ombra', 'Zanna', 'Neve', 'Fumo', 'Brace', 'Selva', 'Rupe', 'Nebbia', 'Lampo', 'Quercia', 'Artiglio',
        'Tuono', 'Cenere', 'Vento', 'Aurora', 'Fiocco', 'Sasso', 'Lince', 'Brina', 'Notte', 'Falco', 'Rovo', 'Ghiaccio']


# ───────── dati ─────────

IN = 4 * N + len(NAMES)


def encode(a, b, s):
    # ogni cifra due volte: "quale è" (one-hot) e "quanto è grande" (termometro), così la rete può capire la regola
    x = np.zeros(IN, dtype=np.float32)
    x[a] = 1
    x[N + b] = 1
    x[2 * N: 2 * N + a] = 1
    x[3 * N: 3 * N + b] = 1
    x[4 * N + s] = 1
    return x


def build_data(rng):
    """Per ogni materia: 80% dei fatti per studiare, 20% per l'esame segreto (mai visti)."""
    study, secret = {}, {}
    for s, name in enumerate(NAMES):
        facts = [(a, b) for a in range(N) for b in range(N)]
        rng.shuffle(facts)
        cut = int(len(facts) * 0.8)
        to_xy = lambda fs: (np.stack([encode(a, b, s) for a, b in fs]), np.array([SKILLS[name](a, b) for a, b in fs]))
        study[name] = to_xy(facts[:cut])
        secret[name] = to_xy(facts[cut:])
    return study, secret


# ───────── la rete (MLP a 2 strati nascosti) ─────────

def init(rng):
    d = IN
    he = lambda i, o: (rng.standard_normal((i, o)) * math.sqrt(2 / i)).astype(np.float32)
    return {'W1': he(d, HIDDEN), 'b1': np.zeros(HIDDEN, np.float32), 'W2': he(HIDDEN, HIDDEN), 'b2': np.zeros(HIDDEN, np.float32),
            'W3': he(HIDDEN, OUT), 'b3': np.zeros(OUT, np.float32)}


def forward(p, X):
    h1 = np.maximum(0, X @ p['W1'] + p['b1'])
    h2 = np.maximum(0, h1 @ p['W2'] + p['b2'])
    return h1, h2, h2 @ p['W3'] + p['b3']


def predict(p, X):
    return forward(p, X)[2].argmax(1)


def train(p, X, Y, steps, lr, rng, batch=64):
    """Adam su entropia incrociata. Restituisce una COPIA addestrata."""
    p = {k: v.copy() for k, v in p.items()}
    m = {k: np.zeros_like(v) for k, v in p.items()}
    v2 = {k: np.zeros_like(v) for k, v in p.items()}
    for t in range(1, steps + 1):
        idx = rng.integers(0, len(X), size=min(batch, len(X)))
        x, y = X[idx], Y[idx]
        h1, h2, z = forward(p, x)
        z = z - z.max(1, keepdims=True)
        prob = np.exp(z)
        prob /= prob.sum(1, keepdims=True)
        dz = prob
        dz[np.arange(len(y)), y] -= 1
        dz /= len(y)
        g = {'W3': h2.T @ dz, 'b3': dz.sum(0)}
        d2 = (dz @ p['W3'].T) * (h2 > 0)
        g['W2'], g['b2'] = h1.T @ d2, d2.sum(0)
        d1 = (d2 @ p['W2'].T) * (h1 > 0)
        g['W1'], g['b1'] = x.T @ d1, d1.sum(0)
        for k in p:
            m[k] = 0.9 * m[k] + 0.1 * g[k]
            v2[k] = 0.999 * v2[k] + 0.001 * g[k] ** 2
            p[k] -= lr * (m[k] / (1 - 0.9 ** t)) / (np.sqrt(v2[k] / (1 - 0.999 ** t)) + 1e-8)
    return p


def exam(p, data):
    return {n: float((predict(p, X) == Y).mean()) for n, (X, Y) in data.items()}


def merged_xy(data, names):
    return np.concatenate([data[n][0] for n in names]), np.concatenate([data[n][1] for n in names])


# ───────── riproduzione: fusione dei pesi ─────────
# Tutti discendono dallo stesso antenato: ogni modello = antenato + "vettore di esperienza" (tau).
# Fondere significa combinare i vettori di esperienza dei genitori.

def tau(p, base):
    return {k: p[k] - base[k] for k in p}


def with_tau(base, t):
    return {k: base[k] + t[k] for k in base}


def merge(A, B, base, recipe, rng):
    ta, tb = tau(A, base), tau(B, base)
    if recipe['tipo'] == 'media':           # media pesata, un peso diverso per ogni strato
        out = {}
        for k in ta:
            w = recipe['pesi'][k]
            out[k] = recipe['forza'] * (w * ta[k] + (1 - w) * tb[k])
        return with_tau(base, out)
    if recipe['tipo'] == 'somma':           # "task arithmetic": somma le due esperienze
        return with_tau(base, {k: recipe['forza'] * (ta[k] + tb[k]) for k in ta})
    if recipe['tipo'] == 'ties':            # TIES: tieni solo i cambiamenti forti, risolvi i conflitti di segno
        out = {}
        for k in ta:
            keep = []
            for t in (ta[k], tb[k]):
                thr = np.quantile(np.abs(t), 1 - recipe['densita'])
                keep.append(np.where(np.abs(t) >= thr, t, 0))
            sign = np.sign(keep[0] + keep[1])
            agree = [np.where(np.sign(t) == sign, t, 0) for t in keep]
            cnt = sum((a != 0).astype(np.float32) for a in agree)
            out[k] = recipe['forza'] * sum(agree) / np.maximum(cnt, 1)
        return with_tau(base, out)
    if recipe['tipo'] == 'dare':            # DARE: butta a caso una parte dei cambiamenti e riscala il resto
        out = {}
        for k in ta:
            keep = 1 - recipe['drop']
            ma = rng.random(ta[k].shape) < keep
            mb = rng.random(tb[k].shape) < keep
            out[k] = recipe['forza'] * (ta[k] * ma + tb[k] * mb) / keep
        return with_tau(base, out)
    raise ValueError(recipe['tipo'])


def random_recipe(rng, keys):
    tipo = ['media', 'somma', 'ties', 'dare'][rng.integers(4)]
    r = {'tipo': tipo, 'forza': round(float(rng.uniform(0.6, 1.1)), 2)}
    if tipo == 'media':
        r['forza'] = round(float(rng.uniform(1.2, 2.0)), 2)
        r['pesi'] = {k: round(float(rng.uniform(0.2, 0.8)), 2) for k in keys}
    if tipo == 'ties':
        r['densita'] = round(float(rng.uniform(0.2, 0.6)), 2)
        r['forza'] = round(float(rng.uniform(0.8, 1.6)), 2)
    if tipo == 'dare':
        r['drop'] = round(float(rng.uniform(0.3, 0.8)), 2)
    return r


# ───────── evoluzione ─────────

def run(seed=3, generations=8, parents_per_gen=4, kids_per_couple=4, mutation_p=0.5, mutation_steps=25):
    rng = np.random.default_rng(seed)
    study, secret = build_data(rng)
    all_x, all_y = merged_xy(study, NAMES)
    t0 = time.time()
    nodes = []
    budget = {'passi': 0}
    names_iter = iter([f'{NOMI[i % len(NOMI)]}{"" if i < len(NOMI) else f"-{i // len(NOMI) + 1}"}' for i in range(10000)])

    def add(p, gen, kind, parents=(), recipe=None, mutation=None, name=None):
        sc = exam(p, study)
        sec = exam(p, secret)
        node = {
            'id': len(nodes), 'nome': name or next(names_iter), 'gen': gen, 'tipo': kind, 'genitori': list(parents),
            'ricetta': recipe, 'mutazione': mutation,
            'voti': {k: round(v, 3) for k, v in sc.items()}, 'voto': round(float(np.mean(list(sc.values()))), 4),
            'segreto': round(float(np.mean(list(sec.values()))), 4),
            'scelto': False,
        }
        nodes.append(node)
        models[node['id']] = p
        return node

    models = {}

    # 1. antenato: ha visto solo un po' di tutto
    idx = rng.permutation(len(all_x))[: int(len(all_x) * 0.06)]
    base = train(init(rng), all_x[idx], all_y[idx], 100, 3e-3, rng)
    budget['passi'] += 100
    ancestor = add(base, -1, 'antenato', name='Antenato')
    ancestor['scelto'] = True

    # 2. PCR: un fondatore per materia (primer = "diventa esperto di <materia>")
    founders = []
    for s in NAMES:
        # il primer insiste sulla materia, con un 15% di ripasso delle altre (come un vero addestramento mirato)
        X, Y = study[s]
        others = [n for n in NAMES if n != s]
        ox, oy = merged_xy(study, others)
        sel = rng.permutation(len(ox))[: len(X) // 4]
        p = train(base, np.concatenate([X, ox[sel]]), np.concatenate([Y, oy[sel]]), 500, 2e-3, rng)
        budget['passi'] += 500
        n = add(p, 0, 'fondatore', parents=[ancestor['id']], recipe={'tipo': 'pcr', 'primer': s})
        n['primer'] = s
        founders.append(n)

    # riferimenti onesti
    soup = with_tau(base, {k: sum(tau(models[f['id']], base)[k] for f in founders) / len(founders) for k in base})
    soup_score = float(np.mean(list(exam(soup, study).values())))
    direct = train(base, all_x, all_y, budget['passi'] - 100, 2e-3, rng)  # stesso numero di passi dei fondatori, ma con TUTTI i dati insieme
    direct_score = float(np.mean(list(exam(direct, study).values())))
    direct_secret = float(np.mean(list(exam(direct, secret).values())))

    # 3-4. generazioni
    parents = sorted(founders, key=lambda n: -n['voto'])[:parents_per_gen]
    for p in parents:
        p['scelto'] = True
    history = [{'gen': 0, 'migliore': max(f['voto'] for f in founders), 'media': float(np.mean([f['voto'] for f in founders])),
                'segreto': max(f['segreto'] for f in founders)}]
    keys = list(base)
    for g in range(1, generations + 1):
        couples = [(parents[i], parents[j]) for i in range(len(parents)) for j in range(i + 1, len(parents))]
        rng.shuffle(couples)
        couples = couples[: parents_per_gen]  # 4 coppie per generazione
        kids = []
        for A, B in couples:
            for _ in range(kids_per_couple):
                recipe = random_recipe(rng, keys)
                child = merge(models[A['id']], models[B['id']], base, recipe, rng)
                mutation = None
                if rng.random() < mutation_p:
                    weak = min(exam(child, study).items(), key=lambda kv: kv[1])[0]
                    X, Y = study[weak]
                    child = train(child, X, Y, mutation_steps, 1e-3, rng)
                    budget['passi'] += mutation_steps
                    mutation = weak
                kids.append(add(child, g, 'figlio', parents=[A['id'], B['id']], recipe=recipe, mutation=mutation))
        # selezione: i migliori tra figli e genitori (i genitori forti possono restare)
        pool = kids + parents
        parents = sorted(pool, key=lambda n: -n['voto'])[:parents_per_gen]
        for p in parents:
            p['scelto'] = True
        history.append({'gen': g, 'migliore': max(k['voto'] for k in kids), 'media': float(np.mean([k['voto'] for k in kids])),
                        'segreto': max(k['segreto'] for k in kids)})

    alpha = max(nodes, key=lambda n: n['voto'])
    # la linea di sangue dell'alfa, fino all'antenato
    lineage, stack = set(), [alpha['id']]
    while stack:
        i = stack.pop()
        if i in lineage:
            continue
        lineage.add(i)
        stack.extend(nodes[i]['genitori'])
    for n in nodes:
        n['stirpe'] = n['id'] in lineage

    best_founder = max(founders, key=lambda n: n['voto'])
    return {
        'creato': time.strftime('%Y-%m-%d %H:%M'),
        'secondi': round(time.time() - t0, 1),
        'seed': seed,
        'materie': NAMES,
        'parametri': int(sum(v.size for v in base.values())),
        'alfa': alpha['id'],
        'riferimenti': {
            'miglior_fondatore': best_founder['voto'],
            'zuppa_fondatori': round(soup_score, 4),
            'addestramento_diretto': round(direct_score, 4),
            'addestramento_diretto_segreto': round(direct_secret, 4),
            'antenato': ancestor['voto'],
        },
        'passi_addestramento': budget['passi'],
        'storia': history,
        'nodi': nodes,
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--gen', type=int, default=8)
    a = ap.parse_args()
    here = Path(__file__).parent
    res = run(a.seed, a.gen)
    (here / 'risultati.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    tpl = here / 'albero.template.html'
    if tpl.exists():
        (here / 'albero.html').write_text(tpl.read_text(encoding='utf-8').replace('/*DATI*/null', json.dumps(res, ensure_ascii=False)), encoding='utf-8')
    alpha = res['nodi'][res['alfa']]
    r = res['riferimenti']
    print(f"{len(res['nodi'])} lupi in {res['secondi']}s ({res['parametri']} parametri ciascuno)")
    print(f"antenato {r['antenato']:.1%} · miglior fondatore {r['miglior_fondatore']:.1%} · zuppa {r['zuppa_fondatori']:.1%} · diretto {r['addestramento_diretto']:.1%}")
    for h in res['storia']:
        print(f"  gen {h['gen']}: migliore {h['migliore']:.1%}  media {h['media']:.1%}  segreto {h['segreto']:.1%}")
    print(f"ALFA: {alpha['nome']} (gen {alpha['gen']}) {alpha['voto']:.1%}  segreto {alpha['segreto']:.1%}  {alpha['voti']}")
