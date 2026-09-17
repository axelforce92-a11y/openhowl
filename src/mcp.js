// Client MCP minimale (stdio, JSON-RPC 2.0): collega server di strumenti esterni configurati in openhowl.config.json.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class McpClient {
  constructor(name, conf) {
    this.name = name;
    this.conf = conf;
    this.seq = 0;
    this.pending = new Map();
  }

  start() {
    this.proc = spawn(this.conf.command, this.conf.args || [], {
      env: { ...process.env, ...(this.conf.env || {}) },
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = msg.id != null && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error(`Server MCP "${this.name}" terminato`));
      this.pending.clear();
    });
  }

  request(method, params = {}, timeout = 60000) {
    const id = ++this.seq;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`Timeout MCP ${method}`)); }, timeout);
    });
  }

  async connect() {
    this.start();
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'openhowl', version: '1.0.0' } });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools = [] } = await this.request('tools/list');
    return tools.map((t) => this.wrap(t));
  }

  wrap(t) {
    const client = this;
    return {
      name: `mcp__${this.name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      description: `[MCP ${this.name}] ${t.description || ''}`,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
      risk: t.annotations?.readOnlyHint ? 'read' : 'exec',
      async run(input) {
        const r = await client.request('tools/call', { name: t.name, arguments: input }, 300000);
        const text = [], images = [];
        for (const c of r.content || []) {
          if (c.type === 'text') text.push(c.text);
          else if (c.type === 'image') images.push({ media_type: c.mimeType, data: c.data });
          else text.push(JSON.stringify(c));
        }
        if (r.isError) throw new Error(text.join('\n') || 'Errore MCP');
        return { text: text.join('\n'), images };
      },
    };
  }

  close() { this.proc?.kill(); }
}
