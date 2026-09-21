// Converte gli upload binari in testo prima della compilazione della LLM Wiki.
// I byte originali vengono comunque conservati in raw/ per garantire la provenienza.
import path from 'node:path';
import crypto from 'node:crypto';
import { OfficeParser } from 'officeparser';

const TEXT = new Set(['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.html', '.htm', '.xml', '.yaml', '.yml', '.log', '.ini', '.toml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rs', '.go', '.sql']);
const OFFICE = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.odg', '.rtf', '.epub']);

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export async function extractUploads(files = [], progress = () => {}) {
  if (!Array.isArray(files) || !files.length) throw new Error('Seleziona almeno un file.');
  const extracted = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i] || {};
    const name = String(item.path || item.name || `documento-${i + 1}`);
    const ext = path.extname(name).toLowerCase();
    const buffer = item.data ? Buffer.from(String(item.data), 'base64') : Buffer.from(String(item.text || ''), 'utf8');
    if (!buffer.length) continue;
    if (buffer.length > 30 * 1024 * 1024) throw new Error(`${name} supera il limite di 30 MB per file.`);
    progress({ phase: 'extract', current: i + 1, total: files.length, name });
    let text;
    if (TEXT.has(ext) || (!ext && !buffer.includes(0))) {
      text = buffer.toString('utf8');
    } else if (OFFICE.has(ext)) {
      try {
        const ast = await OfficeParser.parseOffice(new Uint8Array(buffer), {
          fileType: ext.slice(1),
          extractAttachments: false,
          ignoreSlideMasters: true,
        });
        text = String((await ast.to('text', { textConfig: { preserveLayout: false, pageSeparator: '\n\n--- pagina ---\n\n' } })).value || '');
      } catch (error) {
        throw new Error(`Non riesco a leggere ${name}: ${error.message}`);
      }
    } else {
      throw new Error(`Formato non supportato: ${ext || name}. Sono accettati testo, codice, PDF, Word, Excel, PowerPoint, OpenDocument, RTF ed EPUB.`);
    }
    text = text.replace(/\u0000/g, '').trim();
    if (!text) throw new Error(`${name} non contiene testo estraibile. Se è un PDF scansionato serve l'OCR.`);
    extracted.push({ name, text, data: buffer.toString('base64'), sourceHash: digest(buffer), size: buffer.length });
  }
  if (!extracted.length) throw new Error('Nessun contenuto testuale trovato nei file selezionati.');
  return extracted;
}

export const SUPPORTED_DOCUMENTS = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'ODT', 'ODS', 'ODP', 'RTF', 'EPUB', 'Markdown', 'testo', 'CSV', 'JSON', 'HTML', 'codice sorgente'];
