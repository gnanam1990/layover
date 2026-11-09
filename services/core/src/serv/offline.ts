import type { ServClient, CallOpts, StepName } from "./client";
import { ServUpstreamError } from "./client";

/**
 * Offline stand-in for SERV Reasoning, used only when no SERV_API_KEY is set (tests, offline dev).
 * Deterministic regex extraction; RightsExplain and ClaimDraft refuse so the deterministic fallbacks run.
 * /health and the UI flag this mode so it can never be mistaken for SERV in a recording.
 */
const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function dates(text: string, year = "2026"): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) out.push(m[1]!);
  for (const m of text.matchAll(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?/gi,
  )) {
    const mm = MONTHS[m[1]!.slice(0, 3).toLowerCase()]!;
    out.push(`${year}-${mm}-${m[2]!.padStart(2, "0")}`);
    if (m[3]) out.push(`${year}-${mm}-${m[3].padStart(2, "0")}`);
  }
  return out;
}

function untrusted(user: string) {
  return /<untrusted>\n([\s\S]*)\n<\/untrusted>/.exec(user)?.[1] ?? user;
}

function tripIntake(text: string) {
  const flights = [
    ...text.matchAll(/\b([A-Z0-9]{2})\s?(\d{2,4})\b[^\n,]*?\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/g),
  ].map((m) => {
    const after = text.slice(m.index ?? 0);
    return {
      carrier: m[1]!,
      number: m[2]!,
      from: m[3]!,
      to: m[4]!,
      date: dates(after)[0] ?? null,
      bookingRef: null,
    };
  });
  const confirmation = /\b([A-Z]{2}-\d{3,6})\b/.exec(text)?.[1] ?? null;
  const name = /\b(Hotel [A-Z][\w]*(?: [A-Z][\w]*)*)/.exec(text)?.[1] ?? null;
  const hotelPart = name
    ? text.slice(text.indexOf(name))
    : confirmation
      ? text.slice(text.indexOf(confirmation))
      : "";
  const hd = dates(hotelPart);
  const paid = /paid\s*(?:USD\s*)?\$?\s*(\d+(?:\.\d{1,2})?)/i.exec(text)?.[1];
  const hotels =
    name || confirmation
      ? [
          {
            name,
            checkIn: hd[0] ?? null,
            checkOut: hd[1] ?? null,
            confirmation,
            pricePaid: paid ? Number(paid) : null,
          },
        ]
      : [];
  const traveler = /\b(?:I am|I'm|name is|for)\s+([A-Z][a-z]+)\b/.exec(text)?.[1] ?? null;
  const missing: string[] = [];
  if (!traveler) missing.push("What's the traveler's name?");
  if (!flights.length && !hotels.length) missing.push("Which flight are you taking (number, route, date)?");
  for (const h of hotels) if (!h.checkOut) missing.push("Which date do you check out?");
  return { travelerName: traveler, flights, hotels, missing };
}

function noticeParse(text: string) {
  const t = text.toLowerCase();
  const state = /cancel/.test(t)
    ? "cancelled"
    : /delay/.test(t)
      ? "delayed"
      : /reschedul/.test(t)
        ? "rescheduled"
        : "unknown";
  const reasonClass = /weather|storm|snow|fog/.test(t)
    ? "weather"
    : /air traffic|atc/.test(t)
      ? "atc"
      : /security/.test(t)
        ? "security"
        : /strike/.test(t)
          ? "strike"
          : /crew/.test(t)
            ? "crew"
            : /technical|maintenance|operational/.test(t)
              ? "technical"
              : "unknown";
  const alternatives = [
    ...text.matchAll(/\b[A-Z0-9]{2}\d{2,4}\s+\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?Z?/g),
  ].map((m) => m[0]);
  return {
    state,
    newDepUtc: null,
    offeredAlternatives: alternatives,
    offeredVoucher: /voucher|credit/.test(t),
    reasonClass,
    noticeAtUtc: null,
  };
}

export function createOfflineServ(): ServClient & { offline: true } {
  return {
    offline: true,
    async call<T>(step: StepName, opts: CallOpts<T>): Promise<T> {
      let out: unknown;
      switch (step) {
        case "TripIntake":
          out = tripIntake(untrusted(opts.user));
          break;
        case "NoticeParse":
          out = noticeParse(untrusted(opts.user));
          break;
        case "OptionRank": {
          const opts2 = JSON.parse(opts.user.split("Options (ranked): ")[1] ?? "[]") as {
            distanceKm: number | null;
          }[];
          out = {
            why: opts2.map((o) => `Closest good option (${o.distanceKm ?? "?"} km), free cancellation.`),
          };
          break;
        }
        default:
          throw new ServUpstreamError(`SERV offline: ${step} needs SERV_API_KEY`);
      }
      const v = opts.schema.parse(out);
      opts.postCheck?.(v);
      return v;
    },
  };
}
