// Segreti sul disco (token dei bot, credenziali di WhatsApp) cifrati con l'account Windows dell'utente.
//
// Nell'app desktop usiamo safeStorage di Electron (DPAPI su Windows): il file copiato su un altro PC,
// o letto da un altro utente Windows, è inutilizzabile. Col solo server (node src/server.js) su Windows
// si ripiega sulla stessa DPAPI tramite PowerShell; altrove il segreto resta in chiaro (e lo diciamo).
import { execFileSync } from 'node:child_process';

let box = null; // { encrypt(string) → base64, decrypt(base64) → string }

// Chiamata dall'app desktop all'avvio, prima di startServer.
export function useSafeStorage(b) { box = b; }

// true quando cifrare costa poco (safeStorage): allora cifriamo anche i tanti file delle chiavi di WhatsApp.
export const fastSeal = () => !!box;

const PS = (script, input) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  input, encoding: 'utf8', windowsHide: true, timeout: 15000,
}).trim();
const DPAPI_OUT = "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd();";

function dpapiProtect(text) {
  return PS(`${DPAPI_OUT} [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,'CurrentUser'))`, text);
}
function dpapiUnprotect(b64) {
  return PS(`${DPAPI_OUT} [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s.Trim()),$null,'CurrentUser'))`, b64);
}

export function sealKind() {
  if (box) return 'safeStorage';
  if (process.platform === 'win32') return 'dpapi';
  return 'plain';
}

export function seal(text) {
  const s = String(text ?? '');
  if (box) return `e1:${box.encrypt(s)}`;
  if (process.platform === 'win32') {
    try { return `d1:${dpapiProtect(s)}`; } catch { /* PowerShell non disponibile: resta in chiaro */ }
  }
  return `p0:${s}`;
}

export function unseal(sealed) {
  const s = String(sealed ?? '');
  if (s.startsWith('e1:')) {
    if (!box) throw new Error('Segreto cifrato dall\'app desktop: apri OpenHowl dall\'app, non dal solo server.');
    return box.decrypt(s.slice(3));
  }
  if (s.startsWith('d1:')) return dpapiUnprotect(s.slice(3));
  if (s.startsWith('p0:')) return s.slice(3);
  return s;
}
