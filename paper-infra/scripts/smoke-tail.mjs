import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const clean = text => String(text || '').replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[url]')
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential]')
  .replace(/\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*["']?[^"'&,\s]+/gi, '$1=[redacted]')
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 220);

// Wrangler emits formatted JSON objects rather than newline-delimited records.
// Decode chunked objects, but report only execution outcome, never request headers/URLs.
export function tailDecoder(report) {
  let buffer = '', depth = 0, quoted = false, escaped = false;
  return chunk => {
    for (const char of String(chunk)) {
      if (!depth) { if (char !== '{') continue; buffer = ''; quoted = false; escaped = false; }
      buffer += char;
      if (quoted) {
        if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      if (buffer.length > 262144) { buffer = ''; depth = 0; quoted = false; escaped = false; continue; }
      if (!depth) {
        try {
          const event = JSON.parse(buffer);
          if (typeof event.outcome === 'string') report({ check: 'worker_execution', service: 'rv-pdf-finder',
            outcome: clean(event.outcome), method: clean(event.event?.request?.method),
            http_status: event.event?.response?.status, cpu_ms: event.cpuTime, wall_ms: event.wallTime,
            exceptions: (Array.isArray(event.exceptions) ? event.exceptions : []).slice(0, 3)
              .map(item => ({ name: clean(item.name), message: clean(item.message) })) });
        } catch {}
        buffer = '';
      }
    }
  };
}
export async function startSmokeTail(report, spawnProcess = spawn) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let child, timer, ready = false, closed = false, resolveReady;
  const connected = new Promise(resolve => { resolveReady = resolve; });
  try {
    child = spawnProcess(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'tail', 'rv-pdf-finder',
      '--config', 'stage2/wrangler.pdf-finder.jsonc', '--format', 'json'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: '36c3a32f4feac9d764c4f82b66c3a9d5' },
    });
    const markReady = () => { if (!ready) { ready = true; report({ check: 'worker_tail', service: 'rv-pdf-finder', connected: true }); resolveReady(); } };
    const decode = tailDecoder(value => { markReady(); report(value); }); let connectionText = '';
    const receive = chunk => {
      const text = chunk.toString();
      if (!ready) {
        connectionText = (connectionText + text).slice(-3000);
        if (/Connected to .*waiting for logs/i.test(connectionText)) {
          markReady();
        }
      }
      decode(text);
    };
    child.stdout.on('data', receive);
    // Connection notices can be sent to stderr; do not print any raw CLI output.
    child.stderr.on('data', receive);
    child.on('error', () => { closed = true; resolveReady(); });
    child.on('close', () => { closed = true; resolveReady(); });
    timer = setTimeout(resolveReady, 3000);
    await connected; clearTimeout(timer);
    if (!ready) report({ check: 'worker_tail', service: 'rv-pdf-finder', state: closed ? 'unavailable' : 'starting',
      note: 'JSON tail confirms connection when the first execution event arrives.' });
  } catch { report({ check: 'worker_tail', service: 'rv-pdf-finder', connected: false }); }
  return { async stop() { clearTimeout(timer); if (child && !closed) child.kill(); } };
}
