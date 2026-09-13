# Put Scanner — Codex working rules

Put Scanner is a production React/Vite/TypeScript application for short-put analysis and portfolio management. Make the smallest robust change that fulfills the request; preserve behavior outside scope.

When the session explicitly identifies the active model as GPT-6 Astra, also read [docs/agents/astra.md](docs/agents/astra.md). Other models skip it; if model identity is unavailable, use these global rules without guessing.

## Scope and safety

- Check `git status` before editing and preserve unrelated/user-authored work. Never reset, discard, overwrite, or silently incorporate unrelated changes.
- Inspect relevant implementation and tests with targeted search. Reuse canonical helpers, components, tokens, caches, Workers, and existing tests. Fix root causes without unrelated refactoring, formatting, speculative infrastructure, or dependencies.
- Safe local edits, tests, fixes attributable to the request, and local app/browser verification are within an implementation request. Existing authorization persists; do not ask again for routine steps. Local execution does not authorize production access or live-data writes.
- Unless already explicitly authorized, ask before major dependencies/services/providers; schema/RLS/cloud or durable-format changes; material financial-formula or historical-semantics changes; Portfolio/partial-close ledger redesign; material request fan-out increases; or competing domain implementations.
- Deleting, bulk-rewriting, or migrating user financial data requires explicit authorization and an appropriate backup/recovery path. Production mutations, deployment, destructive/irreversible operations, and external side effects require authorization.
- Commit/push or amend/rewrite history only when requested. Never commit secrets, credentials, private workbooks, or user financial data; never log or copy private financial data into fixtures. Use sanitized/fabricated fixtures.

## Delegation

- The primary owns scope, architecture, consequential judgment, integration, and final correctness. Complete simple tasks directly; delegate independent, bounded work when it saves meaningful expensive-model work or latency, or provides useful independent evidence. Use the [configured roles and invocation notes](docs/agents/README.md); prefer cheaper workers for clear execution and stronger reasoning for ambiguity or consequential review.
- Supply the objective, constraints, relevant file/domain pointers, decided semantics, and acceptance criteria. Prefer fresh or minimally forked context when supported, retaining necessary correctness context. Keep worker file ownership disjoint; subagents stay within scope and return unresolved decisions. Review consequential output and perform appropriate final verification.
- The primary retains unresolved decisions about financial formulas, exact option identity, durable lots/assignment economics, historical-entry and provenance/freshness semantics, persistence/cloud authority/CAS, database/RLS, bulk user data, Recommendations ranking/verdicts, option-market integrity, material provider fan-out, and architectural redesign. Workers may implement explicit decisions in these areas.

## Contextual navigation

Read supporting material only for the affected domain; no fixed document stack is required. Current code establishes runtime behavior, but a mismatch with a financial/safety invariant must be investigated rather than treated as permission to weaken it. Historical stage reports describe their stage, not standing task instructions or authorization to run old rollout steps. Verify named prerequisite commits only when the task depends on them.

| Task | Relevant source |
| --- | --- |
| Financial metrics and price bases | [Metric definitions](docs/PUT_METRIC_DEFINITIONS.md); canonical helpers in `src/lib/` |
| Chain identity, validity, provenance | [Option market integrity](docs/OPTION_MARKET_INTEGRITY.md) |
| Portfolio entry, lifecycle, assignment | [Historical entry model](docs/HISTORICAL_TRADE_ENTRY_MODEL.md); `src/lib/portfolioContractIdentity.ts`, `portfolioContractPositions.ts`, `portfolioRealizedEconomics.ts` |
| Historical analytics or aggregation | [Rolling methodology](docs/ROLLING_HISTORICAL_ANALYTICS_MODEL.md), [history semantics](docs/PORTFOLIO_HISTORY_SEMANTICS_REFINEMENT.md), [group aggregates](docs/PORTFOLIO_HISTORY_GROUP_AGGREGATES.md) |
| Persistence, account state, schema | [Stage 7A](docs/PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md) supersedes Stage 4/5 runtime designs; `supabase/migrations/` and `supabase/tests/` define schema/security checks |
| Requests, caching, service boundaries | [Market architecture](MARKET_DATA_ARCHITECTURE.md), [operational reliability](docs/PRODUCT_STAGE6B3_OPERATIONAL_RELIABILITY.md); `api/` is the serverless surface; `src/lib/requestBudgets.ts` defines live regression budgets |
| Recommendations or technical assessment | [Engine methodology](docs/RECOMMENDATIONS_ENGINE_V1.md), [shared technical assessment](docs/UNDERLYING_TECHNICAL_ASSESSMENT_V1.md) |
| UI, text size, motion | [Design system](docs/UI_DESIGN_SYSTEM.md); relevant sections of [QA checklist](QA_CHECKLIST.md) |
| Setup, commands, deployment configuration | [README](README.md), `package.json`, `vite.config.ts`, `vercel.json`; inspect deployment configuration when changing deployment behavior |

Update the relevant methodology document when live deterministic financial methodology materially changes. Routine code edits do not require documentation rewrites.

## Financial and market integrity

- Reuse canonical financial helpers and raw values, never rounded display strings. The same metric and price basis must agree across surfaces. Preserve Bid/Ask/Last, zero/unavailable, historical/current, entry/current, option/underlying price, and lot/aggregate distinctions. Never invent fallback financial values.
- Apply population filters to input records **before** canonical calculations. Preserve canonical weighting; use aggregate numerator / aggregate denominator where required, not an average of percentages.
- Match exact ticker, expiration, strike (including decimal precision), and option type using canonical contract identity. Never substitute a nearby contract or silently accept a mismatched chain.
- Keep raw provider fields auditable. Retrieval time/source, last-trade recency, structural validity, and surface integrity are distinct. Preserve trusted cached quotes and their original observation timestamps on invalid refresh; record failure separately. Without trusted evidence, economics remain unavailable.
- Never label current data as historical entry data or fill missing Entry Delta/IV with current values. Entry snapshots require eligible exact-contract evidence; market refresh must not rewrite durable historical facts.
- Use canonical U.S. market-calendar helpers for trading-session calculations. Preserve timestamp/source provenance and established corporate-action safety; do not guess adjusted contract terms or historical prices.

## Portfolio and user data

- Each durable `PortfolioTrade` is one independent lot/entry event. Additional sales create new lots, even for identical contracts. Preserve lot-specific entry date, price, Delta, IV, VIX, and lifecycle facts. Contract positions are derived read models, never a second durable authority.
- Current quotes may be contract-level; entry facts remain lot-level. Option execution `closePrice` is separate from underlying-at-close. Assignment requires confirmation, never an inference from moneyness; preserve established assignment economics without inventing stock proceeds or cost basis.
- Historical Excel Import remains additive: one source row per lot, no writes during staging/review, reviewed possible duplicates, legitimate identical-lot multiplicity, backup gate, CAS/revision-protected final batch, no blind conflict retry, and authoritative success verification where established.
- Analytical exports default to one row per canonical lot, use loaded data without provider requests, and leave unavailable values blank rather than synthetic zeroes.
- Supabase is the signed-in durable authority for established account data. Preserve schema/RLS, CAS/revisions, backup behavior, and formats within scope. A stale device must not overwrite newer cloud state. Market caches and derived positions are not durable account authorities; established device-only display preferences may remain local.

## Requests, Recommendations, and performance

- Do not add polling, background refresh loops, fetch-on-hover, per-row/card requests, or unnecessary fan-out unless explicitly requested. Preserve user-triggered refresh, cache-first behavior, bounded batching, deduplication, and abort/generation protections. Sorting, filtering, grouping, column visibility, and display preferences should normally be request-free.
- Recommendations verdict/ranking is deterministic with no LLM inference. Preserve hard gates; `NO TRADE` is valid and distinct from incomplete acquisition/evidence. Never manufacture results to hit a count. Verdict, actionability ranking, and shortlist remain separate; explanations trace to evidence. Fresh retrieval is not recent price discovery, stale Last is not executable credit, and nearby-strike evidence follows canonical rules.
- ETF Pulse and Recommendations share canonical ticker-level technical definitions (trend, pullback, oversold, recovery, extension, deterioration, broken trend). Market Regime remains separate.
- Preserve prepared pricing/chain evidence, indexed lookups, bounded structures, Worker execution/serialization, and cancellation. Avoid unnecessary global O(N²) work, repeated sorting/normalization, large duplicate object graphs, main-thread serialization, rerenders, retained memory, and long synchronous tasks. Measure meaningful problems and fix complexity before adding Workers/yielding.
- Never optimize by silently reducing underlyings, expirations, evidence quality, recommendation breadth, or financial policy. Material engine optimization requires financial-output equivalence and runtime checks at realistic scale.
- Normal failures should yield controlled error/incomplete/cancel states, not crashes, fabricated results, or a required application restart.

## UI principles

Keep a compact, premium, dense, calm, precise, data-first workstation. Reuse the design system, Tailwind, and existing Lucide icons; new UI/animation frameworks need a concrete justification.

Mobile/iOS needs intentional layout: practical touch targets, safe areas, usable keyboard/input behavior, phone landscape support, contained overlays, and no page-level horizontal overflow. Preserve Small/Medium/Large text sizing with Small as baseline; no page zoom or whole-page transforms. Text-size changes are presentation-only, with no market requests or financial recalculation.

Use shared CSS-first restrained motion and `prefers-reduced-motion`. Avoid heavy effects, financial-value interpolation, geometry-changing table-row animation, API calls, or significant motion overhead.

## Verification and completion

Choose verification by scope and risk. Add/update relevant tests for meaningful behavior, financial, persistence, request, or runtime changes; prefer existing test infrastructure. Run affected checks, fix failures caused by the change, and rerun those checks. Broaden coverage for shared dependencies or unresolved regression risk, not merely because more checks exist.

Run commands from this repository directory (`put-scanner/` if launched from its parent); Node 24.x is declared in `package.json`.

| Change | Verification |
| --- | --- |
| Documentation/instructions only | Review diff, links, hierarchy, and contradictions; app tests are unnecessary unless executable behavior changes |
| Local component behavior | Relevant `node --test tests/<name>.test.mjs`; `npm run typecheck` when types are affected |
| Financial metrics, contract identity, historical/assignment economics | Thorough affected domain regression tests including missing/zero, identity, provenance, and aggregation cases; `npm run verify` for broad impact |
| Persistence/import/export/account safety | Relevant account/CAS/backup/import tests, including conflicts and data preservation; `npm run account-state:check`; broader regression for shared persistence changes |
| Request behavior | Inspect request graph and run `npm run request:ledger` plus affected request tests |
| Meaningful UI change | Inspect the rendered affected view, representative desktop/mobile as applicable; expand viewport/theme/text-size coverage for shared layout changes |
| Broad/high-risk change | `npm run verify` (typecheck, Node tests, selfcheck, responsive script, build, lint) |
| Bundle/dependency/site-wide CSS/JS | `npm run build`, then `npm run build:report` (reuse a completed verify build) |

`npm run dev` starts Vite; use the existing browser/Playwright harness for rendered checks. `npm run responsive:check` runs source guardrails and prints a manual checklist; it does not establish browser correctness. See `QA_CHECKLIST.md` for applicable scenarios. Do not repeatedly run full suites/builds/matrices after every edit.

Before declaring completion, inspect the final diff, remove task-created temporary diagnostics, confirm invariants and scope, and report actual verification and any limitations. Completion means the requested behavior works, attributable issues are fixed, and appropriate checks pass (or a concrete verification blocker is reported). Do not claim checks or browser inspection that did not execute; stop once the task is complete without unrelated expansion.
