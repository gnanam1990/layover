import type { ReactNode } from "react";

export type ChipKind = "protected" | "watching" | "action" | "error" | "simulated" | "neutral";

const CHIP: Record<ChipKind, string> = {
  protected: "bg-olive-50 text-olive-700",
  watching: "bg-sand text-brown-700",
  action: "bg-[#FFF4E5] text-warn",
  error: "bg-[#FEE4E2] text-danger",
  simulated: "border border-dashed border-muted-2 text-muted",
  neutral: "bg-paper-2 text-ink-2 border border-line-warm",
};

export function StatusChip({
  kind,
  children,
  dot = false,
}: {
  kind: ChipKind;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] leading-4 font-medium ${CHIP[kind]}`}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Kite-tail glyph + wordmark. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-ink" aria-label="Layover">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2 L19 9 L12 16 L5 9 Z" fill="var(--olive-700)" />
        <path
          d="M12 16 C 11 18, 13 19, 11.5 21 M11.5 21 l-1.5 -0.5 M11.5 21 l0.5 -1.6"
          stroke="var(--amber-500)"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[18px] font-medium tracking-[-0.01em]">Layover</span>
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-card bg-sand/60 ${className}`} />;
}

export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card p-5 ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="t-caption text-muted">{children}</p>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-pill border border-line-warm bg-white px-2 py-0.5 text-[12px] font-medium text-olive-700 hover:border-olive-600"
    >
      {children} <span aria-hidden>↗</span>
    </a>
  );
}
