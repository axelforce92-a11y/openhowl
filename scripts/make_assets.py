"""Prepara le immagini della mascotte: scontorna lo sfondo bianco, ritaglia, ridimensiona e crea l'icona dell'app.

Uso:  python scripts/make_assets.py
Input:  assets/raw/<posa>.png   (render su sfondo bianco)
Output: ui/wolf/<posa>.png (trasparenti), build/icon.ico, build/icon.png, ui/wolf/head.png
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "ui" / "wolf"
BUILD = ROOT / "build"
OUT.mkdir(parents=True, exist_ok=True)
BUILD.mkdir(parents=True, exist_ok=True)


def cutout(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    sat = mx - mn
    # "chiaro e poco saturo" = candidato sfondo (include l'ombra grigio chiaro sotto i piedi)
    near_white = (mn > 186) & (sat < 16)
    # vicino al pavimento l'ombra è più scura: soglia più bassa nell'ultimo 12% dell'immagine
    floor = int(rgb.shape[0] * 0.88)
    near_white[floor:] |= (mn[floor:] > 140) & (sat[floor:] < 14)
    # sfondo = zone chiare connesse ai bordi, oppure "buchi" chiari ampi (es. tra braccio e corpo)
    labels, _ = ndimage.label(near_white)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, border[border > 0])
    # buchi interni: solo bianco puro (il gilet grigio chiaro non ci rientra)
    pure = (mn > 238) & (sat < 8) & ~bg
    hl, hn = ndimage.label(pure)
    if hn:
        hs = ndimage.sum(pure, hl, range(1, hn + 1))
        bg |= np.isin(hl, np.nonzero(hs > 700)[0] + 1)
    fg = ndimage.binary_opening(~bg, iterations=2)
    # tieni solo il soggetto principale (via eventuali frammenti d'ombra staccati)
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        fg = lab == (np.argmax(sizes) + 1)
    fg = ndimage.binary_erosion(fg, iterations=1)
    a = np.asarray(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    # decontaminazione: togli il bianco "mescolato" nei pixel semitrasparenti del bordo
    col = rgb.astype(np.float32)
    edge = (a > 0.02) & (a < 0.98)
    safe = np.maximum(a, 0.25)[..., None]
    col[edge] = np.clip((col[edge] - (1 - safe[edge]) * 255) / safe[edge], 0, 255)
    out = Image.fromarray(np.dstack([col.astype(np.uint8), (a * 255).astype(np.uint8)]), "RGBA")
    return out.crop(out.getbbox())


poses = {}
for f in sorted(RAW.glob("*.png")):
    im = cutout(Image.open(f))
    im.thumbnail((520, 700), Image.LANCZOS)
    im.save(OUT / f"{f.stem}.png", optimize=True)
    poses[f.stem] = im
    print(f"{f.stem}: {im.size}")

# Icona: testa del lupo dalla posa "idle"
src = Image.open(RAW / "idle.png").convert("RGB")
w, h = src.size
full = cutout(src)
fw, fh = full.size
head = full.crop((int(fw * 0.12), 0, int(fw * 0.72), int(fh * 0.40)))
side = max(head.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(head, ((side - head.width) // 2, side - head.height), head)

# sfondo arrotondato verde acqua, stile moderno
size = 512
icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
mask = Image.new("L", (size, size), 0)
from PIL import ImageDraw
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=110, fill=255)
grad = Image.linear_gradient("L").resize((size, size)).rotate(-35)
teal_a, teal_b = np.array([94, 170, 168]), np.array([46, 118, 122])
g = np.asarray(grad).astype(np.float32)[..., None] / 255
colors = (teal_a * (1 - g) + teal_b * g).astype(np.uint8)
bg = Image.fromarray(np.dstack([colors, np.asarray(mask)]), "RGBA")
icon.alpha_composite(bg)
head_img = square.resize((int(size * 0.92), int(size * 0.92)), Image.LANCZOS)
icon.alpha_composite(head_img, ((size - head_img.width) // 2, size - head_img.height))
# ritaglia la testa dentro il quadrato arrotondato
icon.putalpha(Image.fromarray(np.minimum(np.asarray(icon.getchannel("A")), np.asarray(mask))))
icon.save(BUILD / "icon.png")
icon.save(BUILD / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
square.resize((256, 256), Image.LANCZOS).save(OUT / "head.png", optimize=True)
icon.resize((32, 32), Image.LANCZOS).save(ROOT / "ui" / "favicon.png")
# icona piccola per la tray
icon.resize((64, 64), Image.LANCZOS).save(BUILD / "tray.png")
print("icone create")
