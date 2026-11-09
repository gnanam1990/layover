const SECRET_KEY = /token|jwt|secret|api[_-]?key|private|password|authorization|signature/i;

/** Deep-copies `v`, hiding token-like fields and `token=` query params. Use before logging kpass output. */
export function redact(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/([?&](?:token|code|jwt)=)[^&\s"]+/gi, "$1[redacted]");
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(val);
    return out;
  }
  return v;
}
