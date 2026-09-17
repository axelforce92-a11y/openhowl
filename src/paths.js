// Percorsi reali dell'utente. Su Windows Desktop/Documenti possono essere spostati (es. da OneDrive):
// il modello spesso scrive "C:\Users\nome\Desktop", che in quel caso è una cartella nascosta e sbagliata.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cache = null;

export function knownFolders() {
  if (cache) return cache;
  const home = os.homedir();
  cache = { desktop: path.join(home, 'Desktop'), documents: path.join(home, 'Documents'), downloads: path.join(home, 'Downloads'), pictures: path.join(home, 'Pictures') };
  if (process.platform === 'win32') {
    try {
      const script = "[Environment]::GetFolderPath('Desktop');[Environment]::GetFolderPath('MyDocuments');" +
        "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}';" +
        "[Environment]::GetFolderPath('MyPictures')";
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
        .split(/\r?\n/).map((s) => s.trim());
      const [desktop, documents, downloads, pictures] = out;
      if (desktop) cache.desktop = desktop;
      if (documents) cache.documents = documents;
      if (downloads) cache.downloads = downloads.replace(/%USERPROFILE%/i, home);
      if (pictures) cache.pictures = pictures;
    } catch { /* restano i percorsi standard */ }
  }
  return cache;
}

const ALIASES = [
  [/^(desktop|scrivania)$/i, 'desktop', 'Desktop'],
  [/^(documents|documenti)$/i, 'documents', 'Documents'],
  [/^(downloads?)$/i, 'downloads', 'Downloads'],
  [/^(pictures|immagini)$/i, 'pictures', 'Pictures'],
];

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// I modelli piccoli, scrivendo JSON, perdono spesso le barre rovesciate dei percorsi Windows:
// "C:\Users\tizio\file.txt" arriva come "C:Userstiziofile.txt". Qui lo ricostruiamo camminando
// sul disco e riconoscendo, passo per passo, il nome di cartella più lungo che combacia.
function healCollapsedPath(s) {
  const m = s.match(/^([a-zA-Z]):(.*)$/);
  if (!m) return null;
  let dir = `${m[1].toUpperCase()}:\\`;
  let rest = m[2];
  if (!fs.existsSync(dir)) return null;
  while (rest) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }
    const lower = rest.toLowerCase();
    const hit = entries
      .filter((e) => lower.startsWith(e.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) break;
    dir = path.join(dir, hit);
    rest = rest.slice(hit.length);
  }
  if (dir.length <= 3) return null;
  return rest ? path.join(dir, rest) : dir; // la coda è il nome del file nuovo da creare
}

// Risolve un percorso scritto dal modello nel percorso reale sul disco.
export function resolveUserPath(base, p = '.') {
  const home = os.homedir();
  const kf = knownFolders();
  let s = String(p).trim().replace(/^["']|["']$/g, '');
  // percorso "attaccato al disco" (C:cartella) oppure con le barre perse
  if (/^[a-zA-Z]:[^\\/]/.test(s)) {
    const healed = healCollapsedPath(s);
    s = healed || s.replace(/^([a-zA-Z]):/, '$1:\\');
  }
  s = s.replace(/%USERPROFILE%|\$env:USERPROFILE|\$HOME/gi, home).replace(/^~(?=$|[\\/])/, home);

  // "Desktop\progetto" → desktop reale
  const first = s.split(/[\\/]/)[0];
  for (const [re, key] of ALIASES) {
    if (re.test(first)) { s = kf[key] + s.slice(first.length); break; }
  }

  let abs = path.resolve(base, s);
  // "C:\Users\nome\Desktop\..." quando il Desktop vero è altrove (OneDrive)
  for (const [, key, legacyName] of ALIASES) {
    const legacy = path.join(home, legacyName);
    if (path.resolve(kf[key]).toLowerCase() !== legacy.toLowerCase() && inside(abs, legacy)) {
      abs = path.join(kf[key], path.relative(legacy, abs));
      break;
    }
  }
  return abs;
}
