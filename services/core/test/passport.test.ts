import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { createMerchantApp } from "@layover/mocks";
import { SimulatedFacilitator } from "@layover/mocks/sim-facilitator";
import { KPASS_ARGV, KpassPassport, buildArgv, type KpassRunner } from "../src/passport/kpass";
import { FakePassport } from "../src/passport/fake";
import { PassportError, mapKpassError } from "../src/passport/errors";
import { DirectX402Payer } from "../src/passport/direct";
import { redact } from "../src/passport/redact";
import { fixedClock } from "./helpers";

const MERCHANT = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const BOOK = {
  hotelId: "lumen-goa",
  roomClass: "standard",
  checkIn: "2026-12-22",
  checkOut: "2026-12-24",
  refundTo: WALLET,
};

function merchant() {
  const facilitator = new SimulatedFacilitator();
  const app = createMerchantApp({
    facilitator,
    network: "testnet",
    payTo: MERCHANT,
    priceScale: 100,
    publicUrl: "https://merchant.test",
  });
  const fetch = ((input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input instanceof Request ? input.url : input), init)) as typeof globalThis.fetch;
  return { app, facilitator, fetch };
}

// ---------------- argv table (S9) ----------------
describe("kpass argv", () => {
  test("every command ends with --output json --no-interactive", () => {
    for (const argv of [
      buildArgv("status", []),
      buildArgv("walletBalance", []),
      buildArgv("sessionCreate", ["--separate"]),
    ]) {
      expect(argv.slice(-3)).toEqual(["--output", "json", "--no-interactive"]);
    }
  });

  test("session create builds a delegation with settled USD caps and TTL seconds", async () => {
    const calls: string[][] = [];
    const runner: KpassRunner = async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: "human_action_required",
          request_id: "req_1",
          approval_url: "https://agentpassport.ai/agent-session/approve?token=abc",
          user_message: "Approve here",
        }),
        stderr: "",
      };
    };
    const kp = new KpassPassport({ runner, bin: "kpass" });
    const out = await kp.requestSession({
      taskSummary: "Layover trip t1: hotel rebooks and disruption care",
      maxPerTx: "1.20",
      maxTotal: "2.70",
      ttlSeconds: 86400,
      allowedEndpoints: [{ method: "POST", host: "merchant.test", path_prefix: "/v1/book/" }],
    });
    expect(out).toEqual({
      requestId: "req_1",
      approvalUrl: "https://agentpassport.ai/agent-session/approve?token=abc",
      userMessage: "Approve here",
    });
    const argv = calls[0]!;
    expect(argv.slice(0, 2)).toEqual(["session", "create"]);
    expect(argv).toContain("--separate");
    expect(argv).toContain("--no-browser");
    expect(argv).toContain("--no-reuse");
    const delegation = JSON.parse(argv[argv.indexOf("--delegation") + 1]!);
    expect(delegation).toEqual({
      task: { summary: "Layover trip t1: hotel rebooks and disruption care" },
      payment_policy: {
        max_amount_per_tx: "1.20",
        max_total_amount: "2.70",
        ttl_seconds: 86400,
        currency: "USD",
      },
      execution_constraints: {
        x402: {
          scope_mode: "scoped",
          allowed_endpoints: [{ method: "POST", host: "merchant.test", path_prefix: "/v1/book/" }],
        },
      },
    });
    expect(delegation.payment_policy.assets).toBeUndefined();
  });

  test("execute passes url, method, headers, body, idempotency key and session id, and parses the tx", async () => {
    const calls: string[][] = [];
    const runner: KpassRunner = async (argv) => {
      calls.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: "success",
          session_id: "session_9",
          usage: { spent_total: "0.72", reserved_total: "0" },
          payment_requirement: { asset: "pieUSD", amount: "0.72" },
          payment: { payment_response: { reference: "0xabc" } },
          x402: { status_code: 200, parsed_response_body: { confirmation: "LX-1" }, chain_id: 2368 },
        }),
        stderr: "",
      };
    };
    const kp = new KpassPassport({ runner, bin: "kpass" });
    const r = await kp.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "t1:hb_1:lumen-goa",
      sessionId: "session_9",
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ confirmation: "LX-1" });
    expect(r.payment).toEqual({ tx: "0xabc", amount: "0.72", asset: "pieUSD", chainId: 2368 });
    const argv = calls[0]!;
    expect(argv.slice(0, 2)).toEqual(["session", "execute"]);
    const flag = (f: string) => argv[argv.indexOf(f) + 1];
    expect(flag("--url")).toBe("https://merchant.test/v1/book/72");
    expect(flag("--method")).toBe("POST");
    expect(JSON.parse(flag("--headers")!)).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(flag("--body")!)).toEqual(BOOK);
    expect(flag("--idempotency-key")).toBe("t1:hb_1:lumen-goa");
    expect(flag("--session-id")).toBe("session_9");
  });

  test("switching the verb table changes only the verbs (snapshot)", () => {
    const original = buildArgv("sessionCreate", ["--separate"]);
    const legacy = buildArgv("sessionCreate", ["--separate"], {
      ...KPASS_ARGV,
      sessionCreate: ["agent:session", "create"],
    });
    expect(legacy.slice(2)).toEqual(original.slice(2));
    expect(legacy.slice(0, 2)).toEqual(["agent:session", "create"]);
    expect(original).toMatchSnapshot();
  });

  test("non-zero exit maps to PassportError with code and hint, raw output redacted", async () => {
    const runner: KpassRunner = async () => ({
      exitCode: 6,
      stdout: JSON.stringify({
        status: "error",
        error: "Amount exceeds per-transaction limit",
        error_code: "session_rule_exceeded",
        hint: "ask for a new session",
        token: "agt_SECRET",
      }),
      stderr: "",
    });
    const kp = new KpassPassport({ runner, bin: "kpass" });
    const err = await kp
      .execute({ url: "https://m/v1/book/72", method: "POST", idempotencyKey: "k" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PassportError);
    expect((err as PassportError).code).toBe("session_rule_exceeded");
    expect(JSON.stringify(err)).not.toContain("agt_SECRET");
    expect((err as Error).message).not.toContain("agt_SECRET");
  });
});

// ---------------- error mapping ----------------
describe("error mapping", () => {
  const cases: [string, string][] = [
    ["session_rule_exceeded", "per-payment"],
    ["session_total_exceeded", "total"],
    ["separate_session_used_up", "total"],
    ["session_endpoint_forbidden", "endpoint"],
    ["payment_target_forbidden", "merchant"],
    ["session_forbidden", "session"],
    ["wallet_empty", "fund"],
  ];
  for (const [code, hintWord] of cases) {
    test(code, () => {
      const e = mapKpassError({ error_code: code, error: "x", hint: "" }, 6);
      expect(e.code).toBe(code);
      expect(e.hint.toLowerCase()).toContain(hintWord);
    });
  }
  test("unknown codes become 'unknown' with the exit code kept", () => {
    const e = mapKpassError({ error: "weird" }, 1);
    expect(e.code).toBe("unknown");
    expect(e.exitCode).toBe(1);
  });
  test("cap errors are flagged as session-fatal", () => {
    expect(mapKpassError({ error_code: "session_total_exceeded" }, 6).sessionFatal).toBe(true);
    expect(mapKpassError({ error_code: "provider_unavailable" }, 1).sessionFatal).toBe(false);
  });
});

// ---------------- redaction ----------------
describe("redact", () => {
  test("hides token-like fields and approval tokens", () => {
    const out = redact({
      token: "agt_x",
      jwt: "eyJ",
      nested: { api_key: "k", ok: "visible", approval_url: "https://a/approve?token=SECRET&x=1" },
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("agt_x");
    expect(s).not.toContain("eyJ");
    expect(s).not.toContain("SECRET");
    expect(s).toContain("visible");
  });
});

// ---------------- FakePassport ----------------
describe("FakePassport", () => {
  async function activeFake(opts: { maxPerTx: string; maxTotal: string; ttlSeconds?: number }) {
    const m = merchant();
    const clock = fixedClock("2026-12-20T20:00:00Z");
    const fake = new FakePassport({ fetch: m.fetch, clock, tokenDecimals: 18 });
    const { requestId } = await fake.requestSession({
      taskSummary: "t",
      maxPerTx: opts.maxPerTx,
      maxTotal: opts.maxTotal,
      ttlSeconds: opts.ttlSeconds ?? 3600,
    });
    fake.approve(requestId);
    const s = await fake.awaitSession(requestId, 1000);
    return { fake, clock, session: s, m };
  }

  test("requested sessions are not active until approved", async () => {
    const fake = new FakePassport({ fetch: merchant().fetch, clock: fixedClock("2026-12-20T00:00:00Z") });
    const { requestId } = await fake.requestSession({
      taskSummary: "t",
      maxPerTx: "1",
      maxTotal: "2",
      ttlSeconds: 60,
    });
    expect((await fake.awaitSession(requestId, 20)).status).toBe("timeout");
    const err = await fake
      .execute({ url: "https://merchant.test/v1/book/72", method: "POST", body: BOOK, idempotencyKey: "a" })
      .catch((e) => e);
    expect((err as PassportError).code).toBe("session_forbidden");
  });

  test("pays the merchant's 402 within caps and returns the settlement tx", async () => {
    const { fake, session, m } = await activeFake({ maxPerTx: "1.20", maxTotal: "2.70" });
    expect(session.status).toBe("active");
    const r = await fake.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "a",
    });
    expect(r.status).toBe(200);
    expect((r.body as { confirmation: string }).confirmation).toMatch(/^LX-/);
    expect(r.payment?.tx).toMatch(/^0xsim/);
    expect(r.payment?.amount).toBe("0.72");
    expect(m.facilitator.settleCalls).toBe(1);
    expect(fake.spentTotal()).toBe("0.72");
  });

  test("enforces max per tx exactly", async () => {
    const { fake } = await activeFake({ maxPerTx: "0.71", maxTotal: "5" });
    const err = await fake
      .execute({ url: "https://merchant.test/v1/book/72", method: "POST", body: BOOK, idempotencyKey: "a" })
      .catch((e) => e);
    expect((err as PassportError).code).toBe("session_rule_exceeded");
  });

  test("enforces max total exactly (0.72 + 0.72 > 1.43)", async () => {
    const { fake } = await activeFake({ maxPerTx: "1", maxTotal: "1.43" });
    await fake.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "a",
    });
    const err = await fake
      .execute({
        url: "https://merchant.test/v1/book/72",
        method: "POST",
        body: { ...BOOK },
        idempotencyKey: "b",
      })
      .catch((e) => e);
    expect((err as PassportError).code).toBe("session_total_exceeded");
  });

  test("after TTL, execute fails with session_forbidden", async () => {
    const { fake, clock } = await activeFake({ maxPerTx: "1", maxTotal: "5", ttlSeconds: 60 });
    clock.advance(61_000);
    const err = await fake
      .execute({ url: "https://merchant.test/v1/book/72", method: "POST", body: BOOK, idempotencyKey: "a" })
      .catch((e) => e);
    expect((err as PassportError).code).toBe("session_forbidden");
  });

  test("merchant 409 is returned as-is and nothing is charged", async () => {
    const { fake, m } = await activeFake({ maxPerTx: "1", maxTotal: "5" });
    const r = await fake.execute({
      url: "https://merchant.test/v1/book/58",
      method: "POST",
      body: BOOK,
      idempotencyKey: "a",
    });
    expect(r.status).toBe(409);
    expect(r.payment).toBeUndefined();
    expect(m.facilitator.settleCalls).toBe(0);
    expect(fake.spentTotal()).toBe("0");
  });

  test("same idempotency key returns the first result without paying twice", async () => {
    const { fake, m } = await activeFake({ maxPerTx: "1", maxTotal: "5" });
    const a = await fake.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "same",
    });
    const b = await fake.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "same",
    });
    expect(b).toEqual(a);
    expect(m.facilitator.settleCalls).toBe(1);
  });
});

// ---------------- DirectX402Payer (F2) ----------------
describe("DirectX402Payer (F2)", () => {
  const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

  test("signs an EIP-3009 authorization matching accepts[0] and retries with PAYMENT-SIGNATURE", async () => {
    const m = merchant();
    const payer = new DirectX402Payer({ privateKey: KEY, fetch: m.fetch, chainId: 2368 });
    const r = await payer.execute({
      url: "https://merchant.test/v1/book/72",
      method: "POST",
      body: BOOK,
      idempotencyKey: "k",
    });
    expect(r.status).toBe(200);
    expect(r.payment?.tx).toMatch(/^0xsim/);
    expect(m.facilitator.settleCalls).toBe(1);
    const auth = payer.lastAuthorization!;
    expect(auth.message.to.toLowerCase()).toBe(MERCHANT);
    expect(auth.message.value).toBe(720000000000000000n);
    expect(auth.message.from).toBe(privateKeyToAccount(KEY).address);
    expect(auth.domain).toMatchObject({ name: "pieUSD", version: "1", chainId: 2368 });
    expect(await payer.verifyLastSignature()).toBe(true);
  });

  test("a stale tier still returns 409 and is not settled", async () => {
    const m = merchant();
    const payer = new DirectX402Payer({ privateKey: KEY, fetch: m.fetch, chainId: 2368 });
    const r = await payer.execute({
      url: "https://merchant.test/v1/book/58",
      method: "POST",
      body: BOOK,
      idempotencyKey: "k",
    });
    expect(r.status).toBe(409);
    expect(m.facilitator.settleCalls).toBe(0);
  });
});
