"""Scompone le pose del lupo in livelli animabili ("rig"): corpo, testa, coda, braccia e palpebre.

Uso:  python scripts/make_rig.py        (dopo make_assets.py)
Input:  ui/wolf/<posa>.png
Output: ui/wolf/rig/<posa>-<livello>.png  +  ui/wolf/rig/rig.json

Le immagini sono render singoli, quindi i pezzi si ritagliano con poligoni misurati a mano sulle pose
(coordinate in pixel dell'immagine in ui/wolf). Ogni pezzo ruota attorno al suo perno (spalla, collo,
attaccatura della coda). Il corpo perde solo il "nocciolo" del pezzo: il bordo sfumato resta anche
sotto, così con rotazioni piccole non si aprono buchi lungo il taglio.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ui" / "wolf"
OUT = SRC / "rig"
OUT.mkdir(parents=True, exist_ok=True)

# z: ordine di disegno (la coda sta dietro al corpo). cut_above: il corpo perde il pezzo solo sopra
# questa quota (per la testa: il collo resta in entrambi i livelli e copre la giuntura).
RIG = {
    "idle": {
        "eyes": [(207, 146, 19, 15), (279, 133, 16, 16)],
        "parts": {
            "tail": {"z": -1, "pivot": (170, 575), "poly": [(0, 480), (60, 488), (100, 515), (118, 545), (165, 548), (168, 640), (0, 640)]},
            "head": {"z": 2, "pivot": (240, 250), "cut_above": 205, "poly": [(90, 0), (355, 0), (355, 215), (320, 238), (240, 250), (160, 245), (120, 225), (90, 195)]},
            "armR": {"z": 3, "pivot": (408, 305), "poly": [(382, 105), (492, 105), (492, 265), (432, 305), (392, 308), (380, 262)]},
        },
    },
    "working": {
        "eyes": [(242, 154, 19, 15), (313, 156, 13, 15)],
        "parts": {
            "tail": {"z": -1, "pivot": (158, 575), "poly": [(0, 478), (110, 488), (148, 515), (150, 640), (0, 645)]},
            "head": {"z": 2, "pivot": (255, 258), "cut_above": 210, "poly": [(115, 0), (365, 0), (365, 225), (330, 245), (260, 262), (190, 255), (150, 240), (115, 210)]},
        },
    },
    "approval": {
        "eyes": [(204, 151, 20, 15), (273, 135, 14, 16)],
        "parts": {
            "tail": {"z": -1, "pivot": (160, 575), "poly": [(0, 478), (110, 490), (150, 520), (152, 640), (0, 645)]},
            "head": {"z": 2, "pivot": (240, 250), "cut_above": 205, "poly": [(100, 0), (340, 0), (340, 215), (300, 238), (240, 250), (170, 245), (120, 228), (100, 200)]},
            "armR": {"z": 3, "pivot": (395, 335), "poly": [(385, 170), (474, 170), (474, 300), (420, 345), (385, 345), (378, 300)]},
            "armL": {"z": 3, "pivot": (152, 385), "poly": [(20, 335), (148, 335), (156, 360), (156, 410), (148, 428), (20, 428)]},
        },
    },
    "success": {
        "eyes": [(193, 143, 18, 16), (265, 130, 15, 16)],
        "parts": {
            "tail": {"z": -1, "pivot": (158, 510), "poly": [(0, 370), (80, 370), (110, 450), (150, 480), (155, 590), (0, 590)]},
            "armL": {"z": 3, "pivot": (120, 235), "poly": [(0, 60), (100, 60), (112, 150), (138, 228), (95, 245), (35, 175), (0, 160)]},
            "armR": {"z": 3, "pivot": (335, 225), "poly": [(355, 50), (449, 50), (449, 150), (385, 215), (345, 225), (332, 190), (350, 120)]},
        },
    },
    "thinking": {
        "eyes": [(212, 146, 19, 16), (283, 128, 14, 16)],
        "parts": {
            "tail": {"z": -1, "pivot": (152, 575), "poly": [(0, 480), (100, 490), (140, 520), (145, 645), (0, 645)]},
        },
    },
}

SS = 4  # supersampling per bordi puliti


def poly_mask(size, poly, feather=1.6):
    w, h = size
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in poly], fill=255)
    m = m.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m).astype(np.float32) / 255


def with_alpha(rgba, mask):
    out = rgba.copy()
    out[..., 3] = (out[..., 3].astype(np.float32) * mask).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def lid_shape(size, cx, cy, rx, ry, half):
    """Maschera della palpebra (con bordi morbidi) e i punti della linea delle ciglia."""
    w, h = size
    RX, RY, CX, CY = (rx + 2) * SS, (ry + 2) * SS, cx * SS, cy * SS
    m = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((CX - RX, CY - RY, CX + RX, CY + RY), fill=255)
    if half:
        # palpebra calata fino a poco sotto il centro, con il bordo inferiore curvo verso il basso
        edge = CY + 0.08 * RY
        d.rectangle((0, edge, m.width, m.height), fill=0)
        d.chord((CX - RX, edge - RY * 0.28, CX + RX, edge + RY * 0.28), 0, 180, fill=255)
        m2 = Image.new("L", m.size, 0)
        ImageDraw.Draw(m2).ellipse((CX - RX, CY - RY, CX + RX, CY + RY), fill=255)
        m = Image.fromarray(np.minimum(np.asarray(m), np.asarray(m2)))
        lash = [(CX + u * RX * 0.97, edge + RY * 0.26 * (1 - u * u)) for u in np.linspace(-1, 1, 31)]
    else:
        # occhio chiuso: le ciglia formano un arco sorridente nella metà bassa
        base = CY + 0.30 * RY
        lash = [(CX + u * RX * 0.9, base + RY * 0.24 * (1 - u * u)) for u in np.linspace(-1, 1, 31)]
    m = m.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.9))
    return np.asarray(m).astype(np.float32) / 255, lash


def draw_lids(size, rgba, eyes, half=False):
    """Palpebre ricostruite dal pelo intorno all'occhio (inpainting), con volume e ciglia affusolate."""
    import cv2
    w, h = size
    bgr = cv2.cvtColor(rgba[..., :3].copy(), cv2.COLOR_RGB2BGR)
    hole = np.zeros((h, w), np.uint8)
    for cx, cy, rx, ry in eyes:
        cv2.ellipse(hole, (cx, cy), (rx + 4, ry + 4), 0, 0, 360, 255, -1)
    fill = cv2.inpaint(bgr, hole, 7, cv2.INPAINT_TELEA)
    fill = cv2.cvtColor(fill, cv2.COLOR_BGR2RGB).astype(np.float32)
    # un po' di "pelo": rumore fine allungato in diagonale, come la texture del render
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    k = np.zeros((7, 7), np.float32); np.fill_diagonal(k, 1 / 7)
    noise = cv2.filter2D(noise, -1, k) * 9
    alpha = np.zeros((h, w), np.float32)
    shade = np.ones((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    lashes = []
    for cx, cy, rx, ry in eyes:
        m, lash = lid_shape(size, cx, cy, rx, ry, half)
        alpha = np.maximum(alpha, m)
        # volume: la palpebra è più chiara in alto e scurisce verso le ciglia
        t = np.clip((yy - (cy - ry)) / (2.0 * ry), 0, 1)
        shade = np.where(m > 0, np.minimum(shade, 1.05 - 0.16 * t ** 1.5), shade)
        lashes.append(lash)
    col = np.clip((fill + noise[..., None]) * shade[..., None], 0, 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([col, (alpha * 255).astype(np.uint8)]), "RGBA").resize((w * SS, h * SS), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    for lash in lashes:
        # ciglia affusolate: spesse al centro, sottili agli estremi
        n = len(lash)
        for i in range(n - 1):
            u = abs((i / (n - 1)) * 2 - 1)
            wdt = (2.9 - 2.0 * u ** 2) * SS
            d.line([lash[i], lash[i + 1]], fill=(34, 28, 32, 240), width=max(1, int(wdt)))
        if half:
            # ombra della palpebra sull'occhio, subito sotto il bordo
            sh = [(x, y + 2.2 * SS) for x, y in lash]
            d.line(sh, fill=(20, 16, 18, 70), width=int(2.2 * SS))
    return img.resize((w, h), Image.LANCZOS)


def main():
    manifest = {}
    for pose, spec in RIG.items():
        im = Image.open(SRC / f"{pose}.png").convert("RGBA")
        rgba = np.asarray(im).copy()
        w, h = im.size
        body_keep = np.ones((h, w), np.float32)
        layers = []
        for name, p in spec["parts"].items():
            m = poly_mask((w, h), p["poly"])
            with_alpha(rgba, m).save(OUT / f"{pose}-{name}.png", optimize=True)
            core = poly_mask((w, h), p["poly"], feather=0.1)
            core = np.asarray(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5))).astype(np.float32) / 255
            if "cut_above" in p:
                core[p["cut_above"]:] = 0
            body_keep = np.minimum(body_keep, 1 - core)
            layers.append({"name": name, "z": p["z"], "pivot": [round(p["pivot"][0] / w * 100, 2), round(p["pivot"][1] / h * 100, 2)]})
        with_alpha(rgba, body_keep).save(OUT / f"{pose}-body.png", optimize=True)
        layers.append({"name": "body", "z": 0, "pivot": [50, 100]})

        draw_lids((w, h), rgba, spec["eyes"]).save(OUT / f"{pose}-lids.png", optimize=True)
        draw_lids((w, h), rgba, spec["eyes"], half=True).save(OUT / f"{pose}-lidshalf.png", optimize=True)

        layers.sort(key=lambda l: l["z"])
        manifest[pose] = {"w": w, "h": h, "layers": layers, "lidsOn": "head" if "head" in spec["parts"] else "body"}
        print(f"{pose}: {', '.join(l['name'] for l in layers)} + palpebre")
    # anche le pose senza rig (immagine unica): servono le dimensioni per tenere il lupo alla stessa scala
    for f in sorted(SRC.glob("*.png")):
        if f.stem in manifest or f.stem == "head":
            continue
        w, h = Image.open(f).size
        manifest[f.stem] = {"w": w, "h": h}
    (OUT / "rig.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
