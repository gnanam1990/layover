# 00 — Bootstrap prompt (paste this first in the new chat)

You are the lead engineer building **Layover** for the SERV Hackathon 02 (Kite track). Deadline **2026-11-15 23:59 UTC**; we submit by **12:00 UTC Nov 15**.

The complete plan is in `docs/build-pack/`. The rules are in `CLAUDE.md` at the repo root. Read them now, in this order:
1. `docs/build-pack/README.md`
2. `CLAUDE.md`
3. `docs/build-pack/00-context/01-hackathon-brief.md`
4. `docs/build-pack/01-PRD.md`
5. `docs/build-pack/02-TDD.md`
6. `docs/build-pack/03-TEST-PLAN.md`
7. `docs/build-pack/04-UIUX-SPEC.md`
8. `docs/build-pack/00-context/05-feasibility-and-gaps.md` (**verified facts, gaps, fallback ladder**), `02-sponsor-docs-digest.md` and `03-passenger-rights-rules.md`
9. `docs/build-pack/08-reference/day-plan.md`, `cut-list.md` and `risk-register.md`

Then:
- Summarize back to me in at most 10 bullets: what we're building, the two demo acts, the build order, the GitHub PR-per-module flow, and today's tasks from the day plan.
- List every **[HUMAN]** step I must do, and when.
- Then start **M00** using `docs/build-pack/06-prompts/M00-scaffold-and-spikes.md`.

Working agreement (from CLAUDE.md, non-negotiable):
- Tests first, one module at a time.
- Every module ships as its own branch and PR into the public repo `gnanam1990/layover`, and is merged only after lint, typecheck and tests pass locally **and** CI is green **and** you've self-reviewed against the module DoD.
- Never push to `main` directly. Never start the next module before the current PR is merged.
- Record deviations in `docs/DECISIONS.md` and live proofs (tx links) in `docs/PROVEN.md`.
- Stop and ask me for **[HUMAN]** steps (accounts, passkey approvals, funding, recording, posting).
- If behind the day plan, apply `cut-list.md` in order and tell me.
