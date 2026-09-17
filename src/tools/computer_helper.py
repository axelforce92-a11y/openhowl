"""Helper di OpenHowl per il computer use: esegue un'azione con pyautogui e salva uno screenshot ridimensionato.

Parametri in JSON nella variabile d'ambiente OPENHOWL_CU. Le coordinate ricevute sono nello spazio dello
screenshot ridimensionato (larghezza massima maxW) e vengono riportate ai pixel reali dello schermo.
Sicurezza: il FAILSAFE di pyautogui è attivo, quindi spostare il mouse nell'angolo in alto a sinistra blocca l'azione.
"""
import ctypes
import json
import os
import sys
import time

try:
    import pyautogui
except ImportError:
    sys.exit("pyautogui non installato: esegui  python -m pip install pyautogui")
from PIL import ImageDraw

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.04

KEY_ALIASES = {"escape": "esc", "return": "enter", "cmd": "win", "meta": "win", "super": "win",
               "control": "ctrl", "del": "delete", "pgup": "pageup", "pgdn": "pagedown", "arrowup": "up",
               "arrowdown": "down", "arrowleft": "left", "arrowright": "right"}


def type_unicode(ch):
    """Digita un carattere non ASCII (es. à, €) tramite SendInput KEYEVENTF_UNICODE."""
    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_ulong),
                    ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

    class INPUT(ctypes.Structure):
        class _U(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]
        _anonymous_ = ("u",)
        _fields_ = [("type", ctypes.c_ulong), ("u", _U)]

    for flags in (0x0004, 0x0004 | 0x0002):  # KEYEVENTF_UNICODE, + KEYUP
        inp = INPUT(type=1)
        inp.ki = KEYBDINPUT(0, ord(ch), flags, 0, None)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def type_text(text):
    buf = ""
    for ch in text:
        if ch == "\n":
            pyautogui.write(buf, interval=0.008); buf = ""
            pyautogui.press("enter")
        elif ch.isascii():
            buf += ch
        else:
            pyautogui.write(buf, interval=0.008); buf = ""
            type_unicode(ch)
    pyautogui.write(buf, interval=0.008)


def main():
    return act_and_capture(json.loads(os.environ["OPENHOWL_CU"]))


def act_and_capture(a):
    sw, sh = pyautogui.size()
    scale = min(1.0, a["maxW"] / sw)
    P = lambda v: max(0, int(round(float(v) / scale)))
    act = a["action"]

    if act == "click":
        pyautogui.click(P(a["x"]), P(a["y"]), clicks=int(a.get("clicks") or 1), interval=0.08, button=a.get("button") or "left")
    elif act == "move":
        pyautogui.moveTo(P(a["x"]), P(a["y"]), duration=0.15)
    elif act == "drag":
        pyautogui.moveTo(P(a["x"]), P(a["y"]))
        pyautogui.dragTo(P(a["x2"]), P(a["y2"]), duration=0.5, button="left")
    elif act == "scroll":
        pyautogui.moveTo(P(a["x"]), P(a["y"]))
        pyautogui.scroll(int(a.get("amount") or -3) * 120)
    elif act == "type":
        type_text(a.get("text") or "")
    elif act == "key":
        keys = [KEY_ALIASES.get(k.strip().lower(), k.strip().lower()) for k in (a.get("combo") or "enter").split("+")]
        bad = [k for k in keys if k not in pyautogui.KEYBOARD_KEYS]
        if bad:
            raise ValueError(f"Tasti sconosciuti: {bad}")
        pyautogui.hotkey(*keys, interval=0.03)

    if act != "screenshot":
        time.sleep(float(a.get("delay", 0.7)))

    img = pyautogui.screenshot()
    mx, my = pyautogui.position()
    d = ImageDraw.Draw(img)
    d.ellipse((mx - 12, my - 12, mx + 12, my + 12), outline=(255, 0, 200), width=4)
    w, h = int(img.width * scale), int(img.height * scale)
    img = img.resize((w, h)).convert("RGB")
    img.save(a["out"], "JPEG", quality=75)
    return f"{w}x{h} (schermo {sw}x{sh}), cursore a ({int(mx * scale)}, {int(my * scale)})"


FAILSAFE_MSG = "FAILSAFE: l'utente ha spostato il mouse nell'angolo in alto a sinistra per fermare l'agente. Non riprovare: chiedi all'utente."


def serve():
    """Modalità persistente: una richiesta JSON per riga su stdin, una risposta JSON per riga su stdout."""
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            reply = {"ok": True, "info": act_and_capture(json.loads(line))}
        except pyautogui.FailSafeException:
            reply = {"ok": False, "error": FAILSAFE_MSG}
        except Exception as e:  # l'errore torna all'agente, il processo resta vivo
            reply = {"ok": False, "error": str(e)}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--serve" in sys.argv:
        serve()
    else:
        try:
            print(main())
        except pyautogui.FailSafeException:
            sys.exit(FAILSAFE_MSG)
