"""Icona dell'app dal lupo pixel della mascotte (ui/wolf/howl-atlas.png), in stile "mascotte su sfondo trasparente".

Uso:  python scripts/make_icon.py
Output: build/icon.png, build/icon.ico, build/tray.png, ui/favicon.png, ui/wolf/head.png,
        ui/wolf/px/<posa>.png (celle singole dell'atlas, per le immagini statiche della UI)
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / "ui" / "wolf" / "howl-atlas.png"
BUILD = ROOT / "build"
PX = ROOT / "ui" / "wolf" / "px"
PX.mkdir(parents=True, exist_ok=True)

# stesso ordine di ui/wolf.js
POSES = [
    "idle", "hello", "listening", "thinking",
    "talking", "working", "reading", "searching",
    "approval", "pointing", "success", "thumbsup",
    "worried", "howling", "yawning", "sleeping",
]

atlas = Image.open(ATLAS).convert("RGBA")
cw, ch = atlas.width / 4, atlas.height / 4


def cell(i: int) -> Image.Image:
    x, y = i % 4, i // 4
    c = atlas.crop((round(x * cw), round(y * ch), round((x + 1) * cw), round((y + 1) * ch)))
    # via i puntini semitrasparenti rimasti dallo scontorno
    a = c.getchannel("A").point(lambda v: 0 if v < 40 else v)
    c.putalpha(a)
    return c.crop(c.getbbox())


def square(img: Image.Image, size: int, pad: float, anchor_bottom=False) -> Image.Image:
    inner = round(size * (1 - 2 * pad))
    k = inner / max(img.size)
    im = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    y = size - round(size * pad) - im.height if anchor_bottom else (size - im.height) // 2
    out.paste(im, ((size - im.width) // 2, y), im)
    return out


for i, name in enumerate(POSES):
    cell(i).save(PX / f"{name}.png", optimize=True)

idle = cell(0)
# testa: la parte alta della posa ferma, fino al collare
head = idle.crop((0, 0, idle.width, round(idle.height * 0.66)))
head = head.crop(head.getbbox())

big = square(idle, 512, 0.03)
big.save(BUILD / "icon.png", optimize=True)
# nei formati piccoli il corpo intero diventa illeggibile: dai 48px in giù solo la testa
sizes = [256, 128, 64, 48, 32, 24, 16]
frames = [square(idle if s > 48 else head, s, 0.02 if s > 48 else 0.0) for s in sizes]
frames[0].save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[1:])
square(head, 64, 0.0).save(BUILD / "tray.png", optimize=True)
square(head, 64, 0.0).save(ROOT / "ui" / "favicon.png", optimize=True)
square(head, 256, 0.0).save(ROOT / "ui" / "wolf" / "head.png", optimize=True)
print("ok")
