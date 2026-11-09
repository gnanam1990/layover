# Prompt — M10: Timeline, SSE, chain verifier
Paste into the build chat when the previous module's PR is merged.

You are building **Layover** (rules: `CLAUDE.md`). Current module: **M10 — Timeline, SSE, chain verifier**.

1. Sync and branch: `git checkout main && git pull && git checkout -b m10-timeline-chain`.
2. Read `docs/build-pack/05-modules/M10-timeline-and-chain.md` (the spec, including its "Ship it" section) and `docs/build-pack/03-TEST-PLAN.md §M10`. Also read: 02-TDD.md §3 (TimelineEvent), §7, §12.
3. **Tests first:** write every test listed for M10, run them, and confirm they fail for the right reason.
4. Implement exactly the spec. If reality differs (an API, a flag or a behavior), stop, record the evidence in `docs/DECISIONS.md`, adapt minimally and continue.
5. Run `pnpm lint && pnpm typecheck && pnpm test` (plus any `LIVE=1` suite named in the spec) until everything is green.
6. Module-specific verification: Demonstrate SSE with `curl -N localhost:8787/events?tripId=demo` while appending a test event.
7. Ship: open the PR with the template filled in (what changed, tests, verification evidence, tx links, DoD checklist). `gh pr checks --watch` until green. Self-review `gh pr diff` against the DoD. Then `gh pr merge --squash --delete-branch` and `git checkout main && git pull`.
8. Report back in at most 8 bullets: what was built, test counts, the PR URL, the merged SHA, updates to PROVEN.md and DECISIONS.md, the next module, and any **[HUMAN]** step I need to do next.

Stop and ask me if a **[HUMAN]** step is needed, if a spike result invalidates the design, or if CI isn't green after 3 fix attempts.
