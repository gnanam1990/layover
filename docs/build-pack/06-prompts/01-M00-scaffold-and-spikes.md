# Prompt — M00: Scaffold, public repo, CI & spikes
Paste into the build chat when the previous module's PR is merged.

You are building **Layover** (rules: `CLAUDE.md`). Current module: **M00 — Scaffold, public repo, CI & spikes**.

1. Sync and branch: `git checkout main && git pull && git checkout -b m00-scaffold`.
2. Read `docs/build-pack/05-modules/M00-scaffold-and-spikes.md` (the spec, including its "Ship it" section) and `docs/build-pack/03-TEST-PLAN.md §M00`. Also read: 02-TDD.md §2, §5, §6, §14; 00-context/02-sponsor-docs-digest.md (all); 08-reference/env.example.
3. **Tests first:** write every test listed for M00, run them, and confirm they fail for the right reason.
4. Implement exactly the spec. If reality differs (an API, a flag or a behavior), stop, record the evidence in `docs/DECISIONS.md`, adapt minimally and continue.
5. Run `pnpm lint && pnpm typecheck && pnpm test` (plus any `LIVE=1` suite named in the spec) until everything is green.
6. Module-specific verification: Create the public repo and CI first (spec steps 1–4) and get a first PR (`m00-scaffold`) green and merged. Read `00-context/05-feasibility-and-gaps.md` first. Then on branch `m00-spikes`: deploy the minimal paywalled merchant to public HTTPS (H4), run **S9 → S8/S1 first** (they decide the payment rung F1/F2/F3), then S2–S6. Record each in DECISIONS.md with evidence. If S8 is refused, open the catalog PR and give me the Kite message from `08-reference/kite-allowlist-request.md` to send today. Ask me for H0–H4 when you reach them. Put the first real testnet tx link in PROVEN.md.
7. Ship: open the PR with the template filled in (what changed, tests, verification evidence, tx links, DoD checklist). `gh pr checks --watch` until green. Self-review `gh pr diff` against the DoD. Then `gh pr merge --squash --delete-branch` and `git checkout main && git pull`.
8. Report back in at most 8 bullets: what was built, test counts, the PR URL, the merged SHA, updates to PROVEN.md and DECISIONS.md, the next module, and any **[HUMAN]** step I need to do next.

Stop and ask me if a **[HUMAN]** step is needed, if a spike result invalidates the design, or if CI isn't green after 3 fix attempts.
