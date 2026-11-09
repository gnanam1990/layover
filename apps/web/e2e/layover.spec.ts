import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(__dirname, "..", "..", "..", "docs", "screens");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

async function noSeriousA11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " " + (n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 160)).join(" | ")}`,
    ),
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

let tripUrl = "";

test.beforeAll(async ({ request }) => {
  await request.post("/api/core/demo/reset", { data: {} });
});

test("onboarding: type a trip → answer the missing field → dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your trip's guardian." })).toBeVisible();
  await shot(page, "s1-home");
  await page
    .getByLabel("Tell me about your trip")
    .fill("LH761 FRA→BLR Dec 20, hotel booking HX-2231 at Hotel Lumen Goa Dec 22–24");
  await page.getByRole("button", { name: "Add trip →" }).click();
  await expect(page.getByText("What's the traveler's name?")).toBeVisible();
  await page.getByLabel("Your answer").fill("I'm Priya");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/trips\/trip_/);
  tripUrl = page.url();
  await expect(page.getByText("Priya's trip")).toBeVisible();
  await expect(page.getByText("LH761").first()).toBeVisible();
  await expect(page.getByText("$72.00").first()).toBeVisible(); // price from the merchant, not the model
});

test("protect: exact limits and approval link/QR → fake passkey → Protected", async ({ page }) => {
  await page.goto(tripUrl);
  await expect(page.getByText("Layover can spend up to $270.00 in total, $120.00 per booking")).toBeVisible();
  await page.getByRole("button", { name: "Protect my trip" }).click();
  const handoff = page.getByRole("region", { name: "Approve with Kite Passport" });
  await expect(handoff.getByText("Approve Layover's trip budget")).toBeVisible();
  await expect(handoff.getByText("$120.00")).toBeVisible();
  await expect(handoff.getByText("$270.00")).toBeVisible();
  await expect(handoff.getByAltText(/QR code/)).toBeVisible();
  await expect(handoff.getByRole("link", { name: "Open Kite Passport" })).toHaveAttribute("href", /approve/);
  await shot(page, "s2-protect");
  await handoff.getByRole("button", { name: /Simulate passkey/ }).click();
  await expect(page.getByText("Protected · Layover is watching prices and your flight.")).toBeVisible();
});

test("Act 1: drop price → rebook sequence and savings banner within 5 s", async ({ page }) => {
  await page.goto(tripUrl);
  await page.getByRole("button", { name: "Drop hotel price" }).click();
  await expect(page.getByText("Saved $14.00 · our fee $4.20 · you keep $9.80")).toBeVisible({
    timeout: 5_000,
  });
  const tl = page.getByRole("region", { name: "Trip timeline" });
  await expect(tl.getByText("Paid $58.00 via Kite Passport")).toBeVisible();
  await expect(tl.getByText(/Cancelled Hotel Lumen Goa/)).toBeVisible();
  await expect(tl.getByText("Saved $14.00 · fee $4.20")).toBeVisible();
  await expect(tl.getByText("Simulated").first()).toBeVisible();
  const who = page.getByRole("region", { name: "Who's acting for you" });
  await expect(who.getByText("(agent_fake_layover)")).toBeVisible();
  await expect(who.getByText("$270.00")).toBeVisible();
  await shot(page, "s3-dashboard");
  await noSeriousA11y(page);
});

test("Act 2: cancel flight → voucher warning first, then the booked hotel, then the claim link", async ({
  page,
}) => {
  await page.goto(tripUrl);
  await page.getByRole("button", { name: "Cancel flight" }).click();
  const rescue = page.getByRole("region", { name: "Rescue mode" });
  await expect(rescue.getByText("LH761 is cancelled. You're covered.")).toBeVisible({ timeout: 8_000 });
  await expect(rescue.getByText(/Booked Airport Lodge FRA for tonight/)).toBeVisible({ timeout: 8_000 });
  await expect(rescue.getByRole("link", { name: "Open claim →" })).toBeVisible({ timeout: 8_000 });
  // Fixed order: DoNot banner → Tonight → Rights → … → Claim
  const order = await rescue.evaluate((el) => {
    const text = el.textContent ?? "";
    return [
      text.indexOf("Don't accept a voucher if you want your cash refund"),
      text.indexOf("Booked Airport Lodge FRA"),
      text.indexOf("Your rights"),
      text.indexOf("Open claim"),
    ];
  });
  expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
  await shot(page, "s4-rescue");
  await noSeriousA11y(page);
});

test("claim: entitlements, receipt with tx link, letter, copy and email", async ({ page }) => {
  await page.goto(`${tripUrl}/claim`);
  await expect(page.getByRole("heading", { name: "Your claim to LH" })).toBeVisible();
  await expect(page.getByText("€600.00").first()).toBeVisible();
  const receipts = page.getByRole("region", { name: "Receipts" });
  await expect(receipts.getByText("$96.00")).toBeVisible();
  await expect(receipts.getByRole("link")).toHaveAttribute("href", /kitescan\.ai\/tx\/0x/);
  await expect(page.getByText("Claim value: €600.00 compensation + $96.00 in receipts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy letter" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open email" })).toHaveAttribute("href", /^mailto:/);
  await shot(page, "s5-claim");
  await noSeriousA11y(page);
});

test("keyboard: the main actions are reachable with Tab", async ({ page }) => {
  await page.goto("/");
  const reached = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "",
    );
    if (label) reached.add(label);
  }
  expect([...reached].some((l) => l.includes("Paste confirmation email"))).toBe(true);
  await noSeriousA11y(page);
});
