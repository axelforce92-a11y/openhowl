"""Genera una nuova posa di Howl con Gemini (Nano Banana), usando le pose esistenti come riferimento.

Uso:  python scripts/gen_pose.py <nome> "<descrizione della posa>" [--model gemini-3-pro-image] [--ref idle,approval]
Output: assets/raw/<nome>.png  (render su sfondo bianco, poi: python scripts/make_assets.py)

La chiave si legge da ~/.openhowl/.env (riga GEMINI_API_KEY=... oppure la sola chiave) e non viene mai stampata.
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "raw"

STYLE = (
    "Use the attached images as the character reference: this is Howl, the same anthropomorphic grey wolf mascot. "
    "Keep EXACTLY the same character design: same 3D animated-movie render style, same fur colours (grey back, cream "
    "muzzle and belly), same amber eyes, same light-grey armour chest plate with teal circuit lines and the teal hexagon "
    "badge reading 'OH OpenHowl', same proportions and same bushy tail. "
    "Full body, standing, centred, same scale and framing as the reference images, feet near the bottom edge. "
    "Plain pure white background with only a soft light-grey contact shadow under the feet. "
    "No text other than the badge, no extra objects unless described, no border.\n\nNew pose: "
)


def api_key():
    env = (Path.home() / ".openhowl" / ".env").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"^\s*(?:GEMINI_API_KEY\s*=\s*)?[\"']?(AIza[0-9A-Za-z_\-]{30,})", env, re.M)
    if not m:
        sys.exit("Chiave Gemini non trovata in ~/.openhowl/.env")
    return m.group(1)


def png_b64(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((768, 1024))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("pose")
    ap.add_argument("--model", default="gemini-3-pro-image")
    ap.add_argument("--ref", default="idle,approval")
    ap.add_argument("--out", default=None, help="file di uscita (predefinito assets/raw/<nome>.png)")
    a = ap.parse_args()

    parts = [{"inline_data": {"mime_type": "image/png", "data": png_b64(RAW / f"{r}.png")}} for r in a.ref.split(",")]
    parts.append({"text": STYLE + a.pose})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "3:4"}},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{a.model}:generateContent",
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": api_key(), "content-type": "application/json"},
    )
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=240))
    except urllib.error.HTTPError as e:
        sys.exit(f"Gemini ha risposto {e.code}: {e.read().decode(errors='ignore')[:800]}")

    for cand in resp.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            data = p.get("inlineData") or p.get("inline_data")
            if data:
                im = Image.open(io.BytesIO(base64.b64decode(data["data"]))).convert("RGB")
                im = im.resize((896, 1200), Image.LANCZOS)  # stessa tela delle pose esistenti
                out = Path(a.out) if a.out else RAW / f"{a.name}.png"
                im.save(out)
                print(f"salvata {out}  ({im.size[0]}x{im.size[1]})  usage={json.dumps(resp.get('usageMetadata', {}))}")
                return
    sys.exit("Nessuna immagine nella risposta: " + json.dumps(resp)[:800])


if __name__ == "__main__":
    main()
