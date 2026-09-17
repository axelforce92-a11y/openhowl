// Percorsi reali dell'utente. Su Windows Desktop/Documenti possono essere spostati (es. da OneDrive):
// il modello spesso scrive "C:\Users\nome\Desktop", che in quel caso è una cartella nascosta e sbagliata.
import { execFileSync } from 'node:child_process';
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

// Risolve un percorso scritto dal modello nel percorso reale sul disco.
export function resolveUserPath(base, p = '.') {
  const home = os.homedir();
  const kf = knownFolders();
  let s = String(p).trim().replace(/^["']|["']$/g, '');
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
