export const PIPELINE_VERSION = 'paper-v2.0';
export const VERIFIER_VERSION = 'identity-v1';
export const MAX_PDF_BYTES = 16 * 1024 * 1024;

export class ResolutionError extends Error {
  constructor(code, status = 500, retryAfterMs = 0) {
    super(code); this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

export function normalizeDoi(input) {
  const value = String(input || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  return /^10\.\d{4,9}\/[^\s<>"#?]{1,180}$/i.test(decoded) ? decoded.toLowerCase() : null;
}

export function plainText(input) {
  return String(input || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export function normalizedWords(input) {
  return plainText(input).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

export function titleSimilarity(a, b) {
  const aa = normalizedWords(a), bb = normalizedWords(b);
  if (!aa.length || !bb.length) return 0;
  if (aa.join(' ') === bb.join(' ')) return 1;
  const left = new Set(aa), right = new Set(bb);
  const intersection = [...left].filter(word => right.has(word)).length;
  return 2 * intersection / (left.size + right.size);
}

export function publicUrl(input, base) {
  let url;
  try { url = new URL(input, base); } catch { throw new ResolutionError('invalid_source_url', 400); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !host.includes('.') || /[:\[\]]/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)
      || /^(?:localhost|metadata\.google\.internal)$/.test(host)
      || /\.(?:localhost|local|internal|invalid|test|onion)$/.test(host)) {
    throw new ResolutionError('non_public_source_url', 400);
  }
  url.hash = '';
  return url.toString();
}

export function retryDelay(header, now = Date.now()) {
  const raw = String(header || '').trim();
  const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Math.min(24 * 3600000, Math.max(60000, Number.isFinite(delay) ? delay : 300000));
}

export async function boundedBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel(); throw new ResolutionError('response_too_large', 413);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new ResolutionError('response_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Each invocation owns its counters and deadline. No module-global mutable budget.
export class RequestBudget {
  constructor({ maxRequests = 5, deadline = Date.now() + 5000, fetcher = fetch, clock = Date.now } = {}) {
    this.maxRequests = maxRequests; this.deadline = deadline; this.fetcher = (...args) => fetcher(...args); this.clock = clock;
    this.requests = 0; this.invocations = 0; this.controllers = new Set();
  }
  remaining() { return Math.max(0, this.deadline - this.clock()); }
  async response(input, { accept = 'application/json', maxBytes = 1500000, redirects = 3, headers = {}, headerOnlyForPdf = false } = {}) {
    let url = publicUrl(input);
    for (let hop = 0; hop <= redirects; hop++) {
      if (this.requests >= this.maxRequests) throw new ResolutionError('request_budget_exhausted', 429);
      if (this.remaining() < 50) throw new ResolutionError('deadline_exceeded', 504);
      this.requests++;
      const controller = new AbortController(); this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), Math.min(this.remaining(), 5000));
      try {
        const response = await this.fetcher(url, { method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { accept, 'user-agent': 'ResearchVaultPaper/2.0 (+https://researchvaultagent.ir/)', ...headers } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location'); await response.body?.cancel();
          if (!location || hop === redirects) throw new ResolutionError('redirect_limit', 502);
          url = publicUrl(location, url); continue;
        }
        if (!response.ok) {
          const status = response.status, retry = retryDelay(response.headers.get('retry-after'), this.clock());
          await response.body?.cancel();
          throw new ResolutionError(status === 429 ? 'rate_limited' : status === 403 ? 'access_denied' : 'source_http_error', status, status === 429 ? retry : 0);
        }
        const isPdf = /application\/pdf/i.test(response.headers.get('content-type') || '');
        const bytes = headerOnlyForPdf && isPdf ? (await response.body?.cancel(), new Uint8Array()) : await boundedBytes(response, maxBytes);
        return { bytes, url, status: response.status, contentType: response.headers.get('content-type') || '' };
      } catch (error) {
        if (controller.signal.aborted) throw new ResolutionError('deadline_exceeded', 504);
        throw error;
      } finally { clearTimeout(timer); this.controllers.delete(controller); }
    }
  }
  async json(url, options) {
    const response = await this.response(url, options);
    try { return JSON.parse(new TextDecoder().decode(response.bytes)); }
    catch { throw new ResolutionError('invalid_metadata_response', 502); }
  }
  async text(url, options) {
    const response = await this.response(url, options);
    return { ...response, text: new TextDecoder().decode(response.bytes) };
  }
  cancel() { for (const controller of this.controllers) controller.abort(); }
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export async function requestInput(request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) throw new ResolutionError('request_too_large', 413);
  const raw = new TextDecoder().decode(await boundedBytes(request, 32768));
  let body;
  try { body = JSON.parse(raw); } catch { throw new ResolutionError('invalid_request', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ResolutionError('invalid_request', 400);
  return body;
}

export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}

export function logEvent(event, fields = {}) {
  // Never log provider URLs, document text, customer IDs or raw provider errors.
  console.log(JSON.stringify({ event, version: PIPELINE_VERSION, ...fields }));
}

export function encodeRecord(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > 9000) throw new ResolutionError('result_metadata_too_large', 502);
  return btoa(String.fromCharCode(...bytes));
}
export function decodeRecord(text) {
  if (typeof text !== 'string' || text.length > 12000) throw new ResolutionError('invalid_result_record', 502);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))));
}
