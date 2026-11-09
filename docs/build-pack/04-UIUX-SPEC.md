# Layover: UI/UX spec (Kite theme)

The theme was captured live from **gokite.ai** and **agentpassport.ai** on 2026-11-09 (computed styles plus screenshots). Layover must look like it belongs in the Kite ecosystem: warm cream paper, black ink, olive gradient actions, amber dot accents, and DM Sans with a mono for data. Moments that hand off to Kite Passport (session approval) use the **Passport sub-brand**: Spectral serif headline and an orange accent.

## 1. Design tokens (`apps/web/styles/theme.css`)
```css
:root {
  /* Kite core (gokite.ai) */
  --paper: #FEF8F0;          /* page background */
  --paper-2: #FDF5E8;        /* section band */
  --sand: #F0E3CE;           /* card tint, dividers */
  --surface: #FFFFFF;        /* cards */
  --ink: #000000;            /* headings */
  --ink-2: #353636;          /* body */
  --muted: #6F6F6F;          /* secondary text */
  --muted-2: #B9B1A4;        /* placeholders, disabled */
  --line: #E5E7EB;           /* hairlines */
  --line-warm: #E1D5D0;      /* warm borders */
  --olive-700: #485C11;      /* primary action */
  --olive-600: #5A7015;
  --olive-50:  #E8EFD7;      /* success / protected chip bg */
  --amber-500: #DAA139;      /* dot-grid accent, highlights, savings */
  --brown-700: #5B4B24;      /* warm text on sand */
  /* Kite Passport sub-brand (agentpassport.ai) */
  --pp-ink: #121110;
  --pp-muted: #6B665E;
  --pp-cream: #EFE3D2;
  --pp-orange: #E2703F;      /* passkey / approve accent */
  /* Semantic */
  --ok: #485C11; --warn: #B7791F; --danger: #B42318; --info: #355C7D;
  /* Shape */
  --r-pill: 9999px; --r-card: 16px; --r-panel: 24px; --r-input: 8px;
  --shadow-card: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(91,75,36,.06);
  /* Type */
  --font-sans: "DM Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono: "JetBrains Mono", "Roboto Mono", ui-monospace, monospace;
  --font-serif-pp: "Spectral", Georgia, serif;   /* Passport handoff only */
}
.btn-primary { background: linear-gradient(to right, #485C11, #5A7015, #485C11); color:#fff; border-radius: var(--r-pill);
  font: 700 14px/1 var(--font-sans); padding: 10px 16px; }
.btn-secondary { background:#fff; color: var(--ink); border:1px solid var(--line-warm); border-radius: var(--r-pill); }
.btn-passport { background:#fff; color: var(--pp-orange); border:1px solid var(--pp-orange); border-radius: 4px; }
```
- **Tailwind v4:** map the variables in `@theme { --color-paper: var(--paper); … --font-sans: …; }`.
- **Fonts:** load DM Sans (400/500/700), JetBrains Mono (400/500) and Spectral (400) with `next/font/google`.
- **Typography scale:**

| Use | Size / line-height | Weight | Letter-spacing |
|---|---|---|---|
| Display (hero numbers, e.g. "Saved $14") | 56/60 | 400 | −0.03em (Kite h1: 64px/400/−1.92px) |
| H1 | 36/42 | 400 | −0.02em |
| H2 | 24/30 | 500 | |
| Body | 16/24 | 400 | |
| Small | 14/20 | 400 | |
| Caption/labels | 12/16 | 500, uppercase | 0.06em |

  **Money, tx hashes and flight codes** use `--font-mono`.
- **Background motif:** the amber **dot grid** from gokite.ai, as an SVG pattern of 2 px dots on a 10 px grid in `--amber-500` at 35% opacity. Use it only in the hero and empty states, fading in from one corner. Never put it behind text blocks.

## 2. Components
| Component | Spec |
|---|---|
| **TopBar** | Logo (kite-tail glyph plus the "Layover" wordmark in DM Sans 500), trip switcher, a "Protected" chip, the demo-panel link (DEMO_MODE only). White pill nav on paper, like gokite.ai. |
| **StatusChip** | Pill, 12px/500. Protected = olive-50 bg + olive-700 text with a dot. Watching = sand bg + brown-700. Action needed = #FFF4E5 bg + warn. Error = #FEE4E2 bg + danger. Simulated = dashed border, muted. |
| **TripCard** | Surface card, r=16, shadow-card. Rows: flight (mono code, route FRA → BLR, times, live status), hotel (name, dates, price mono, refundable tag), session meter. |
| **SpendMeter** | Thin bar showing spent / maxTotal in olive, and a per-tx cap tick. Label "Trip budget · $96 of $270 used · max $120 per booking". |
| **DecisionCard** | Shows a PolicyDecision: title ("Rebooked: same room, $14 cheaper"), a checklist of every check (✓ olive / ✕ danger) with details, and a "Why" from SERV OptionRank in muted text. |
| **RightsPanel** | Packs as tabs (EU261 · DOT · DGCA). Each entitlement row: icon, label, amount (mono; "up to" for VERIFY), confidence badge (HIGH olive, MEDIUM amber, VERIFY outline), source link. The **DoNot banner** sits on top: amber left border, bold "Don't accept a voucher if you want your cash refund." |
| **TimelineItem** | Left rail with an amber dot (simulated = hollow dot). Time in mono, title, detail, chips for links ("Payment tx ↗", "Refund tx ↗" to KiteScan). |
| **PassportHandoff** | Panel in the Passport sub-brand: Spectral 28px headline "Approve Layover's trip budget", the exact numbers (per booking, total, valid until, asset USDC), a QR code plus a `btn-passport` "Open Kite Passport". Waiting state: animated dots "Waiting for your passkey…". |
| **SavingsBanner** | Large display number in ink: "Saved $14.00". Sub-line: "Our fee $4.20 (30%) · You keep $9.80". Amber underline accent. |
| **ClaimSheet** | Letter preview (serif-free, DM Sans), entitlements summary, receipts table (desc, amount, tx), "Copy letter" (secondary), "Open email" (primary). |
| **DemoPanel** | Tiny floating panel, bottom-left, dashed border, label "Demo controls (simulated)". Buttons: Drop hotel price, Cancel flight, Delay flight 4h, Reset. |

## 3. Screens and states
### S1 Home / Add trip (`/`)
```
┌ TopBar ─────────────────────────────────────────────┐
│  (dot-grid fade)                                     │
│  Your trip's guardian.                    (H1)       │
│  Saves money before you fly. Rescues you when it breaks.
│  ┌──────────────────────────────────────────────┐   │
│  │ Tell me about your trip…  (textarea)          │   │
│  │ e.g. LH761 FRA→BLR Dec 20, Hotel Lumen Goa…   │   │
│  └──────────────────────────────────────────────┘   │
│  [ Paste confirmation email ]   [ Add trip → ](primary)
│  Recent trips (TripCards)                            │
└─────────────────────────────────────────────────────┘
```
- **States:**
  - Loading: "Reading your trip…" skeleton TripCard.
  - Missing fields: inline question chips ("Which date do you check out?").
  - Error: "Couldn't read that. Try 'flight number, route, date'."
- **Empty state:** the dot-grid plus three example chips that can be clicked to fill the textarea.

### S2 Protect (`/trips/[id]` first visit)
- A limits form with defaults: auto-rebook ON when saving ≥ $5; auto-rescue ON; emergency budget $150; max per booking $120. Live preview sentence: "Layover can spend up to $270 in total, $120 per booking, until Dec 23 18:00."
- The **PassportHandoff** panel appears after "Protect my trip".
- Success: confetti-free, calm. The "Protected" chip animates in, and a toast says "Layover is watching your trip."
- Errors: kpass not logged in shows "Sign in to Kite Passport first" with the copyable command `kpass login init --email …`. A rejected approval shows "Approval declined. Nothing can be spent."

### S3 Trip dashboard (`/trips/[id]`)
- **Left column (8/12):** TripCard, latest DecisionCard, SavingsBanner (if any), RightsPanel (if disrupted).
- **Right column (4/12):** SpendMeter, Timeline (scrollable, live via SSE).
- **Mobile:** a single column with the Timeline as a bottom sheet.

### S4 Rescue mode (auto-opened on disruption)
- A full-width alert band in warm red: "LH761 is cancelled. You're covered."
- **Order (fixed): 1. DoNot banner → 2. "Tonight" card (booked hotel or one-tap confirm) → 3. RightsPanel → 4. "What to say at the desk" (3 bullets from RightsExplain) → 5. Claim ready → link.**
- The tone is calm and directive. Never shout or use red for anything except the alert band.

### S5 Claim (`/trips/[id]/claim`)
- The ClaimSheet. A "Not legal advice · Based on EU261 pack v2026-11-09" footer links to the official source.

### S6 Timeline (full page `/trips/[id]/timeline`)
- Filter chips: All · Money · Rights · Simulated. Each payment or refund shows its KiteScan link.

### S7 Demo panel (`/demo`, DEMO_MODE only)
- Large buttons for the recording (Act 1, Act 2, Reset), plus the current mock state (prices, flight status).

## 4. Microcopy (use verbatim)
| Moment | Copy |
|---|---|
| Hero | "Your trip's guardian. Saves money before you fly. Rescues you when it breaks." |
| Protected | "Protected · Layover is watching prices and your flight." |
| Price drop | "Hotel Lumen dropped to $58. Same room, same dates." |
| Rebooked | "Rebooked. Your old booking was cancelled and $72 came back to your wallet." |
| Savings | "Saved $14.00 · our fee $4.20 · you keep $9.80" |
| Disruption | "LH761 is cancelled. You're covered." |
| Voucher warning | "Don't accept a voucher if you want your cash refund. Ask for the refund in writing." |
| EU care | "The airline owes you a hotel tonight. If the desk can't give one, we've booked it, so keep this receipt to claim it back." |
| Cap hit | "This needs more than your trip budget allows. Approve a bigger budget?" |
| Disclaimer | "Not legal advice. Based on official rules as of <date>. Amounts marked 'up to' need confirming with the airline." |

## 5. Motion and accessibility
- **Motion:** 150–200 ms ease-out for cards and chips. Timeline items slide in 8 px. Respect `prefers-reduced-motion`. No spinners over 2 s; use skeletons.
- **Accessibility:**
  - WCAG AA contrast. Olive-700 on white = 7.6:1 ✓. Amber is used only for accents, never for body text on paper.
  - Focus rings: 2 px olive-600 offset.
  - All icons have labels. Money is announced with currency.
  - Timeline is an `aria-live="polite"` region.
- **Responsive breakpoints:** 375 / 768 / 1280.

## 6. Visual references
gokite.ai hero (cream paper, black DM Sans display, olive gradient pill buttons, amber dot-grid map) · agentpassport.ai (white, Spectral serif headline "Let your agents pay for", orange-outline "Get started" button, blue-cream textured illustration). Use the Passport look only inside PassportHandoff.
