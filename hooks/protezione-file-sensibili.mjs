// Hook di esempio (attivo): protegge i file più delicati e tiene un registro dei comandi.
// Modificalo o cancellalo: sta in ~/.openhowl/hooks/ e vale per ogni conversazione.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROTETTI = [/(^|[\\/])\.env(\.|$)/i, /[\\/]\.ssh[\\/]/i, /[\\/]\.aws[\\/]/i, /id_rsa/i, /[\\/]brains\.json$/i, /\.kdbx$/i];
const LOG = path.join(os.homedir(), '.openhowl', 'comandi.log');

export async function beforeTool({ name, input }) {
  if (['write_file', 'edit_file'].includes(name) && PROTETTI.some((re) => re.test(input.path || ''))) {
    return { deny: 'file protetto da un hook: contiene credenziali o configurazioni sensibili' };
  }
  if (name === 'run_command') {
    try { fs.appendFileSync(LOG, `${new Date().toISOString()}\t${input.command}\n`); } catch {}
  }
  return null;
}
