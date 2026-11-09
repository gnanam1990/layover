import OpenAI from "openai";
import { z, type ZodType } from "zod";
import type { Db } from "../db";

export const SERV_BASE_URL = "https://inference-api.openserv.ai/v1";

export type StepName = "TripIntake" | "NoticeParse" | "RightsExplain" | "OptionRank" | "ClaimDraft";
export type ServTool = "prompt_guard" | { shadow: { hint: string; maxIterations?: number } };

export class ServError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class ServAuthError extends ServError {}
export class ServRateLimitError extends ServError {}
export class ServValidationError extends ServError {}
export class ServUpstreamError extends ServError {}

export interface CallOpts<T> {
  model: string;
  /** Tried in order when the primary model is unavailable (404/400 model errors). */
  fallbackModels?: string[];
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Defaults to z.toJSONSchema(schema). */
  jsonSchema?: Record<string, unknown>;
  tools?: ServTool[];
  /** Extra deterministic check after schema validation; throw ServValidationError to trigger the retry. */
  postCheck?: (value: T) => void;
}

export interface ServClient {
  call<T>(step: StepName, opts: CallOpts<T>): Promise<T>;
}

/** Untrusted text goes only in user messages, wrapped so it cannot close the tag early. */
export function wrapUntrusted(s: string): string {
  return "<untrusted>\n" + s.replaceAll("</untrusted>", "") + "\n</untrusted>";
}

export function toolDefs(tools: ServTool[] = []) {
  return tools.map((t) =>
    t === "prompt_guard"
      ? { type: "function" as const, function: { name: "serv_prompt_guard" } }
      : {
          type: "function" as const,
          function: {
            name: "serv_shadow_agent",
            description: "Enable SERV shadow-agent validation.",
            parameters: {
              type: "object",
              properties: {
                hint: { type: "string", default: t.shadow.hint },
                max_iterations: { type: "integer", default: t.shadow.maxIterations ?? 2 },
              },
            },
          },
        },
  );
}

export function strictJsonSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export interface ServClientOpts {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  db?: Db;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const RATE_BACKOFF_MS = [1000, 2000, 4000];

export function createServClient(o: ServClientOpts): ServClient {
  const openai = new OpenAI({
    apiKey: o.apiKey,
    baseURL: o.baseURL ?? SERV_BASE_URL,
    maxRetries: 0,
    timeout: 60_000,
    ...(o.fetch && { fetch: o.fetch }),
  });
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => new Date());

  const log = (
    step: string,
    model: string,
    tools: ServTool[],
    latencyMs: number,
    ok: boolean,
    err?: unknown,
  ) => {
    if (!o.db) return;
    const names = tools
      .map((t) => (t === "prompt_guard" ? "serv_prompt_guard" : "serv_shadow_agent"))
      .join(",");
    o.db
      .query(
        "INSERT INTO serv_calls (step, model, tools, latencyMs, ok, errorClass, atUtc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(step, model, names, latencyMs, ok ? 1 : 0, err ? (err as Error).name : null, now().toISOString());
  };

  /** One HTTP round trip with the transport-level retry policy (429 backoff, one 5xx retry). */
  async function complete(body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming): Promise<string> {
    let rateTries = 0;
    let upstreamTries = 0;
    for (;;) {
      try {
        const res = await openai.chat.completions.create(body);
        return res.choices[0]?.message?.content ?? "";
      } catch (e) {
        const status = e instanceof OpenAI.APIError ? e.status : undefined;
        if (status === 401 || status === 403)
          throw new ServAuthError(`SERV rejected the API key (${status})`);
        if (status === 429) {
          if (rateTries < RATE_BACKOFF_MS.length) {
            await sleep(RATE_BACKOFF_MS[rateTries++]!);
            continue;
          }
          throw new ServRateLimitError("SERV rate limit persisted after backoff");
        }
        if (status === undefined || status >= 500) {
          if (upstreamTries++ < 1) continue;
          throw new ServUpstreamError(`SERV upstream error (${status ?? "network"})`);
        }
        throw Object.assign(new ServUpstreamError(`SERV request failed (${status})`), { status });
      }
    }
  }

  async function callModel<T>(step: StepName, model: string, opts: CallOpts<T>): Promise<T> {
    const tools = toolDefs(opts.tools);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ];
    const base = {
      model,
      response_format: {
        type: "json_schema" as const,
        json_schema: { name: step, strict: true, schema: opts.jsonSchema ?? strictJsonSchema(opts.schema) },
      },
      ...(tools.length > 0 && { tools }),
    };
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await complete({
        ...base,
        messages,
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      try {
        const value = opts.schema.parse(JSON.parse(content));
        opts.postCheck?.(value);
        return value;
      } catch (e) {
        lastErr =
          e instanceof z.ZodError
            ? e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
            : (e as Error).message;
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content: `Your previous output failed validation: ${lastErr}. Return only JSON matching the schema.`,
          },
        );
      }
    }
    throw new ServValidationError(`${step} output failed validation twice: ${lastErr}`);
  }

  return {
    async call<T>(step: StepName, opts: CallOpts<T>): Promise<T> {
      const models = [opts.model, ...(opts.fallbackModels ?? [])];
      const tools = opts.tools ?? [];
      let lastError: unknown;
      for (const model of models) {
        const t0 = performance.now();
        try {
          const out = await callModel(step, model, opts);
          log(step, model, tools, Math.round(performance.now() - t0), true);
          return out;
        } catch (e) {
          log(step, model, tools, Math.round(performance.now() - t0), false, e);
          lastError = e;
          const status = (e as { status?: number }).status;
          const modelUnavailable = e instanceof ServUpstreamError && (status === 404 || status === 400);
          if (!modelUnavailable) throw e;
        }
      }
      throw lastError;
    },
  };
}
