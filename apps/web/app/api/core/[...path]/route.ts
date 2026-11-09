// Server-side proxy to Layover core. It adds LAYOVER_LOCAL_TOKEN so the browser never holds it,
// and streams responses through (including the SSE timeline).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORE = process.env.CORE_URL ?? "http://localhost:8787";
const TOKEN = process.env.LAYOVER_LOCAL_TOKEN ?? "change-me";

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const target = `${CORE}/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const headers: Record<string, string> = { "x-layover-token": TOKEN };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const last = req.headers.get("last-event-id");
  if (last) headers["last-event-id"] = last;
  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();
  let res: Response;
  try {
    res = await fetch(target, { ...init, signal: req.signal });
  } catch {
    return Response.json(
      { error: "core_unreachable", hint: `Start core (pnpm dev) at ${CORE}` },
      { status: 502 },
    );
  }
  const out = new Headers();
  for (const h of ["content-type", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (out.get("content-type")?.includes("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST };
