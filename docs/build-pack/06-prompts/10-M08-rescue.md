# Prompt — M08: Rescue orchestrator (Act 2)
Paste into the build chat when the previous module's PR is merged.

You are building **Layover** (rules: `CLAUDE.md`). Current module: **M08 — Rescue orchestrator (Act 2)**.

1. Sync and branch: `git checkout main && git pull && git checkout -b m08-rescue`.
2. Read `docs/build-pack/05-modules/M08-rescue.md` (the spec, including its "Ship it" section) and `docs/build-pack/03-TEST-PLAN.md §M08`. Also read: 02-TDD.md §8.3, §9; 01-PRD.md US-4, US-5.
3. **Tests first:** write every test listed for M08, run them, and confirm they fail for the right reason.
4. Implement exactly the spec. If reality differs (an API, a flag or a behavior), stop, record the evidence in `docs/DECISIONS.md`, adapt minimally and continue.
5. Run `pnpm lint && pnpm typecheck && pnpm test` (plus any `LIVE=1` suite named in the spec) until everything is green.
6. Module-specific verification: Live Act 2: cancel LH761 through the demo admin and show the voucher warning first, then the hotel payment tx.
7. Ship: open the PR with the template filled in (what changed, tests, verification evidence, tx links, DoD checklist). `gh pr checks --watch` until green. Self-review `gh pr diff` against the DoD. Then `gh pr merge --squash --delete-branch` and `git checkout main && git pull`.
8. Report back in at most 8 bullets: what was built, test counts, the PR URL, the merged SHA, updates to PROVEN.md and DECISIONS.md, the next module, and any **[HUMAN]** step I need to do next.

Stop and ask me if a **[HUMAN]** step is needed, if a spike result invalidates the design, or if CI isn't green after 3 fix attempts.
