const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|session|api[-_]?key|telegram|credential)/i;

function sanitize(value, depth = 0) {
  if (depth > 4) return '[max-depth]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function safeLog(event) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    ...sanitize(event),
  }));
}

export function traceIdFor(request) {
  const incoming = request.headers.get('x-rv-trace-id')?.trim();
  if (incoming && incoming.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function healthPayload(env, role) {
  return {
    ok: true,
    status: 'ready_stage1',
    service: env.WORKER_ID || 'unknown',
    role,
    source_group: env.SOURCE_GROUP || null,
    version: env.SCAFFOLD_VERSION || 'stage1',
    production_traffic_connected: false,
    timestamp: new Date().toISOString(),
  };
}

export function notImplemented(traceId, service, operation) {
  return json({
    ok: false,
    status: 'infrastructure_only',
    code: 'NOT_IMPLEMENTED_STAGE1',
    service,
    operation,
    trace_id: traceId,
    message: 'Stage 1 scaffold is deployed but production resolution logic is intentionally disabled.',
  }, 501, { 'x-rv-trace-id': traceId });
}
