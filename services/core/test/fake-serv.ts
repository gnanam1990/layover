import type { CallOpts, ServClient, StepName } from "../src/serv/client";
import { ServValidationError } from "../src/serv/client";

export type Handler = (opts: CallOpts<unknown>) => unknown | Promise<unknown>;

/** Fake SERV: per-step handlers; runs the real schema validation and post-checks (one retry like the client). */
export function fakeServ(handlers: Partial<Record<StepName, Handler | Handler[]>>) {
  const calls: { step: StepName; system: string; user: string; model: string }[] = [];
  const serv: ServClient = {
    async call<T>(step: StepName, opts: CallOpts<T>): Promise<T> {
      calls.push({ step, system: opts.system, user: opts.user, model: opts.model });
      const h = handlers[step];
      if (!h) throw new Error(`fake SERV has no handler for ${step}`);
      const list = Array.isArray(h) ? h : [h, h];
      let last: unknown;
      for (let i = 0; i < 2; i++) {
        const fn = list[Math.min(i, list.length - 1)]!;
        try {
          const v = opts.schema.parse(await fn(opts as CallOpts<unknown>));
          opts.postCheck?.(v);
          return v;
        } catch (e) {
          last = e;
        }
      }
      throw last instanceof ServValidationError
        ? last
        : new ServValidationError(String((last as Error)?.message ?? last));
    },
  };
  return { serv, calls };
}
