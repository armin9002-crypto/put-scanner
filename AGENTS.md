# Put Scanner — Codex Working Rules

## Mission

Put Scanner is a production React/Vite/TypeScript financial application for analyzing and managing short-put opportunities.

Treat the CURRENT repository as the source of truth.

For every task, make the smallest robust change that solves the requested problem while preserving financial correctness, user data, request efficiency, runtime performance, and existing behavior outside scope.

Do not broaden the product, refactor unrelated code, or future-proof speculatively unless explicitly requested.

---

## 1. Work Efficiently

Model/tool usage matters.

Start narrow.

Before editing:

1. Read this file.
2. Run `git status`.
3. Inspect the directly relevant implementation and tests.
4. Use targeted `rg`/search rather than browsing the whole repository.
5. Read deeper documentation only when the task touches that domain.
6. Identify:
   - requested outcome;
   - likely root cause;
   - what must not change;
   - smallest likely file set;
   - minimum verification needed.

Do not repeatedly rediscover architecture that current code already establishes.

Do not read every historical doc for every task.

Do not run every test suite before making a change.

### Verification order

Prefer:

1. targeted test/typecheck;
2. fix until targeted checks pass;
3. relevant domain checks;
4. one appropriate final broader verification pass.

Do not repeatedly run full tests, full builds, and large Playwright matrices after every edit.

Visual QA should be proportional to risk.

Localized UI changes usually need representative desktop + mobile checks, not every Theme × Viewport × Text Size combination.

Use broader matrices only for genuinely site-wide/responsive changes.

Stop when the task is correctly implemented and adequately verified.

More files, tests, screenshots, abstractions, and runtime are not inherently better.

---

## 2. Scope and Repository Safety

- Preserve unrelated and user-authored work.
- Never reset, discard, overwrite, or silently incorporate unrelated uncommitted changes.
- Verify assumptions from current code, not old prompts, screenshots, filenames, or stale docs.
- Reuse existing helpers, components, tokens, caches, Workers, patterns, and tests before creating new ones.
- Fix root causes instead of stacking patches around incorrect behavior.
- Avoid new dependencies, frameworks, services, or infrastructure unless genuinely required.
- Do not perform unrelated cleanup, renaming, modernization, or formatting.
- Keep the final diff focused.

If a task depends on recent phased work, verify specifically named prerequisite commits once, then continue.

Do not spend time reconstructing repository history unless the task requires it.

---

## 3. Relevant Documentation

Read only when relevant.

Important references include:

- `docs/PUT_METRIC_DEFINITIONS.md`
- `docs/UI_DESIGN_SYSTEM.md`
- `docs/PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md`
- `docs/PRODUCT_STAGE6B3_OPERATIONAL_RELIABILITY.md`
- `docs/RECOMMENDATIONS_ENGINE_V1.md`
- `docs/UNDERLYING_TECHNICAL_ASSESSMENT_V1.md`
- current Portfolio / Historical Analytics methodology docs

Current implementation wins if older documentation is stale.

If live deterministic financial methodology materially changes, update the relevant methodology doc.

Do not rewrite documentation merely because code changed.

---

## 4. Financial Correctness

Financial calculations are high-risk.

Always reuse canonical financial helpers where they exist.

The same metric and price basis should calculate consistently across applicable surfaces.

Preserve distinctions between:

- Bid / Ask / Last;
- zero / unavailable;
- historical / current;
- entry / current;
- option price / underlying price;
- lot-level / aggregate values.

Never invent plausible fallback financial values.

Never use current market data and label it as historical entry data.

Never replace missing historical Entry Delta or Entry IV with current values.

Do not calculate canonical metrics from rounded display strings when raw values exist.

Use the canonical weighting/aggregation methodology.

Do not average percentages when the metric requires aggregate numerator ÷ aggregate denominator.

### Population filters

If a filter changes the records underlying a financial calculation:

FILTER THE INPUT RECORDS FIRST,
THEN RUN THE CANONICAL CALCULATION.

Do not calculate on the complete population and merely hide excluded output.

---

## 5. Portfolio Architecture

A durable `PortfolioTrade` represents one independent trade lot / entry event.

A unique option contract position is a DERIVED grouping of applicable lots.

Permanent rules:

- Do not durably merge lots merely because ticker/expiration/strike match.
- Additional sales of the same contract create new lots.
- Preserve lot-specific entry date, price, Delta, IV, VIX, and lifecycle facts.
- Aggregation belongs in derived read models/UI.
- Current market data may be contract-level; historical entry facts remain lot-level.
- Do not create a second durable contract-position authority.
- Do not introduce partial-close / transaction-ledger architecture during unrelated tasks.

Historical option execution data and underlying-price context are separate concepts.

For manually closed options, option `closePrice` must not be confused with historical underlying-at-close.

---

## 6. Historical Import / Export

Historical Excel Import is a high-risk bulk-data workflow.

Preserve its established safety model unless explicitly redesigning it:

- one source trade row → one independent lot;
- additive import;
- staging/review causes zero Portfolio writes;
- possible duplicates are reviewed rather than silently merged;
- multiplicity of legitimate identical lots is preserved;
- backup/safety gate remains;
- final batch uses established CAS/revision protection;
- no blind conflict retry;
- success requires authoritative verification where established;
- private user workbooks/data must never be committed, logged, or copied into fixtures.

Use sanitized/fabricated fixtures.

For analytical Portfolio export, default to one row per canonical lot unless explicitly asked for aggregated contract positions.

Export should normally use already-loaded data and make zero provider requests.

Unavailable values remain unavailable/blank rather than synthetic zeroes.

---

## 7. User Data and Persistence

Protect user financial data above convenience.

For signed-in users, Supabase is the durable authority for established account data.

Do not change the cloud-authoritative model, database schema, RLS, CAS/revision semantics, backup behavior, or persistence format unless explicitly required.

A stale device must not silently overwrite newer cloud state.

Market refresh data is transient and must not silently rewrite durable historical trade facts.

Derived contract positions and market caches are not competing durable authorities.

Device-only display preferences may remain local where established.

Never delete, bulk-rewrite, or migrate user financial data without explicit authorization and an appropriate safety path.

---

## 8. Market Data and Request Efficiency

Provider/API efficiency is a permanent requirement.

Do not add:

- polling;
- background refresh loops;
- fetch-on-hover;
- per-row requests;
- per-card requests;
- unnecessary request fan-out;

unless explicitly requested.

Prefer:

- user-triggered refresh;
- existing cache-first behavior;
- bounded batching;
- request deduplication;
- already-loaded data;
- established abort/generation protections.

Sorting, filtering, grouping, column visibility, local display preferences, and similar UI interactions should normally be request-free.

If request behavior changes, inspect the request graph and run the relevant request-ledger checks.

Trading-session calculations should reuse the canonical U.S. market-calendar helpers rather than naive calendar-day math.

---

## 9. Recommendations

Recommendations is a deterministic financial decision system.

Permanent invariants:

- No LLM/AI inference inside verdict/ranking logic.
- Same canonical input should produce the same deterministic result.
- `NO TRADE` is a valid analytical result.
- Incomplete acquisition/evidence is distinct from `NO TRADE`.
- Hard gates remain hard gates.
- Do not manufacture recommendations to hit a target count.
- Verdict, actionability ranking, and surfaced shortlist are separate concepts.
- Fresh API retrieval is not the same as recent option price discovery.
- Stale Last must not masquerade as executable credit.
- Nearby-strike evidence must follow established deterministic rules.
- Explanations must trace to actual evidence.

ETF Pulse and Recommendations share the canonical ticker-level technical assessment where concepts overlap.

Do not create competing definitions of trend, pullback, oversold, recovery, extension, deterioration, or broken trend.

Market Regime remains separate from ticker-level technical assessment.

---

## 10. Recommendations Performance

Recommendations may process thousands of contracts.

Performance and browser responsiveness are part of correctness.

Preserve the optimized architecture:

- avoid unnecessary global O(N²) work;
- pre-index repeated lookups;
- reuse prepared pricing/chain evidence;
- avoid repeated sorting/normalization;
- do not restore unbounded pairwise-detail structures;
- preserve established Worker execution/serialization where applicable;
- preserve cancellation semantics.

Do not “fix” performance by silently reducing:

- underlyings;
- expirations;
- evidence quality;
- recommendation breadth;
- financial policy.

For material engine optimizations, verify both:

1. financial-output equivalence;
2. computational/runtime behavior.

Use realistic scale tests when scale is relevant.

---

## 11. UI / Responsive Design

Put Scanner should remain a compact, premium financial workstation:

- dense;
- calm;
- precise;
- data-first;
- modern;
- restrained.

Reuse the existing design system.

Do not introduce a large UI framework without explicit need.

Mobile/iOS is an intentional layout, not compressed desktop.

Preserve:

- practical touch targets;
- safe areas;
- keyboard/input usability;
- phone landscape support;
- overlay containment;
- no page-level horizontal overflow.

For meaningful UI changes, inspect actual rendered behavior.

### Text Size

Preserve the established Small / Medium / Large text-size architecture.

Small is the baseline.

Do not implement text size using page zoom or whole-page transforms.

Text-size changes are presentation-only and must not trigger market requests or financial recalculation.

### Motion

Preserve shared motion primitives and `prefers-reduced-motion`.

Use CSS-first restrained motion.

Do not add animation libraries unless explicitly justified.

Avoid gimmicky movement, heavy effects, animated financial interpolation, and geometry-changing table-row animation.

Motion must not introduce API calls or significant runtime overhead.

---

## 12. Testing

Testing should be proportional to risk.

Add or update tests for meaningful changes to:

- user-visible behavior;
- financial calculations;
- persistence/data safety;
- request behavior;
- major runtime behavior.

Prefer existing relevant tests over new test infrastructure.

Useful broader checks when applicable:

- request behavior → `npm run request:ledger`
- responsive/cross-site UI → `npm run responsive:check`
- broad/high-risk change → `npm run verify`
- meaningful bundle/dependency/site-wide CSS/JS change → `npm run build:report`
- cloud/persistence → relevant account/CAS/backup tests
- Recommendations performance → scale/equivalence/browser checks as appropriate

Do not run every check merely because it exists.

If a check cannot actually run, say so.

Never claim browser verification that did not execute.

---

## 13. Performance and Error Handling

Measure meaningful performance problems before optimizing them.

Watch for:

- unnecessary O(N²) loops;
- repeated sorting/date calculations;
- repeated normalization;
- duplicate large object graphs;
- large main-thread serialization;
- unnecessary React state/rerenders;
- retained memory;
- long synchronous tasks.

Fix unnecessary complexity first.

Use Workers/yielding when justified after fixing the underlying inefficiency.

Normal failures should not require restarting the application.

Prefer controlled error/incomplete/cancel states over crashes or fabricated results.

---

## 14. Ask Before Major Expansion

Unless explicitly authorized, stop and ask before:

- adding a major framework/dependency/service/provider;
- changing database/schema/RLS/cloud architecture;
- changing durable storage format;
- rewriting user financial data;
- materially changing canonical financial formulas;
- changing historical-data semantics;
- redesigning Portfolio transaction architecture;
- introducing partial-close ledger architecture;
- materially increasing provider request fan-out;
- maintaining two competing implementations of the same domain behavior.

Read-only investigation is allowed.

---

## 15. Git and Completion

Before editing:

`git status`

Never discard unrelated work.

Do not amend/rewrite existing history unless explicitly requested.

Commit/push only when requested.

Never commit secrets, credentials, private financial spreadsheets, or user financial data.

Before declaring success:

1. inspect the final diff;
2. confirm every changed file is necessary;
3. check for unintended financial/request/persistence changes;
4. remove temporary diagnostics;
5. run the appropriate final verification;
6. report limitations honestly.

A task is DONE when:

- requested behavior works;
- root cause is addressed;
- relevant invariants remain intact;
- appropriate tests pass;
- final diff is focused.

STOP WHEN DONE.

Do not convert a completed task into an unrelated cleanup, refactor, documentation expansion, test expansion, or speculative optimization project.