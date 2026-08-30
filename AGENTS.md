# Put Scanner — Codex Working Rules

## Purpose

Put Scanner is a production React/Vite/TypeScript financial application for analyzing and managing short-put opportunities, with a current focus on leveraged ETFs.

Treat the existing repository as the source of truth. Understand the current implementation before changing it.

The broader future ThetaGang/general premium-selling product is separate. Do not broaden Put Scanner into that product unless explicitly requested.

## Scope Guard

Complete the requested task with the smallest robust change that solves the actual problem.

Before editing:
- Read the relevant implementation, tests, configuration, and nearby patterns directly.
- Check `git status` and do not disturb unrelated or user-authored work.
- Verify assumptions from code rather than relying on filenames, old docs, search snippets, or guesses.
- Identify the requested outcome, what must not change, the smallest likely file set, and the checks that prove the result.

While editing:
- Fix root causes instead of stacking patches around incorrect behavior.
- Reuse existing components, helpers, design tokens, utilities, caches, and test infrastructure before adding anything new.
- Do not introduce a framework, adapter, abstraction layer, dependency, service, or configuration system unless the task genuinely requires it.
- Do not perform unrelated cleanup, modernization, renaming, or refactoring.
- Preserve behavior outside the requested scope.
- Remove code that is genuinely replaced; do not keep obsolete paths unless compatibility is explicitly required.

Explicitly requested architectural work may be large. The scope guard is not a prohibition on larger changes; it prevents unrequested expansion.

## Read the Relevant Source of Truth

Do not load every historical document for every task. Read deeper docs only when relevant.

Important current references include:
- `docs/PUT_METRIC_DEFINITIONS.md` — financial metric definitions and formulas.
- `docs/UI_DESIGN_SYSTEM.md` — current visual and responsive system.
- `docs/PRODUCT_STAGE7A_CLOUD_AUTHORITATIVE_STATE.md` — current account persistence architecture.
- `docs/PRODUCT_STAGE6B3_OPERATIONAL_RELIABILITY.md` — request observability and request-budget principles.

Current code wins if historical documentation describes architecture that has since been retired.

## Financial Correctness

Financial calculations are high-risk behavior.

- Use existing canonical metric helpers; do not reimplement formulas independently in different surfaces.
- A metric representing the same concept and price basis must calculate consistently across Scanner, Screener, Watchlist, Portfolio, ticker detail, and Option Drawer.
- Preserve Bid / Ask / Last semantics and the Portfolio Mark Book behavior.
- Preserve the distinction between zero and unavailable/missing data.
- Fail closed when required financial inputs are missing or invalid; do not invent plausible fallback values.
- Never rewrite historical trade economics merely to fill missing data.
- Never use current market data and label it as historical entry data.

User-facing terminology is intentionally concise:
- `NY` / `Nominal Yield`
- `AY` / `Annualized Yield`
- `Gross Risk`
- `Net Risk`
- `Entry NY` / `Entry AY`
- `Current NY` / `Current AY`

Do not globally rename financial concepts without explicit instruction. Tooltips may explain the exact underlying formula even when the visible label is concise.

### Entry Delta

Entry Delta is durable historical trade data.
- Capture it only from a valid contemporaneous exact-contract value, a valid canonical contemporaneous calculation, explicit manual/imported data, or an actual stored historical snapshot.
- Never substitute today's/current Delta for an older trade's Entry Delta.
- Missing trustworthy historical Entry Delta should remain unavailable.

## User Data and Persistence

Protect user financial data above convenience.

### Durable account data

For signed-in users, Supabase is the sole durable authority for:
- Portfolio and history
- Watchlist and notes
- Entry Delta / Entry VIX and other established durable trade fields
- account-level portable preferences

The browser is not a competing durable account database.

For signed-out users, Portfolio/Watchlist account data must not silently persist as durable browser state.

Legacy local account data is inert and must never automatically overwrite, merge into, or block authoritative cloud state.

Retain cloud revision/CAS protection so a stale device cannot silently overwrite newer cloud data.

Do not change the cloud-authoritative model, Supabase schema, RLS, CAS semantics, backup behavior, or persistence format unless the task explicitly requires it.

### Market and device data

Do not confuse account persistence with caching.

Preserve existing local/server market-data caches and request deduplication unless explicitly changing them.

Device-only presentation state such as theme or appropriate UI state may remain local.

### Durable vs transient Portfolio work

- Market quote refreshes are transient and must not silently mutate durable Portfolio state.
- Lifecycle changes, Entry VIX maintenance, and other durable maintenance remain explicit actions.
- Backup/import/restore operations must protect existing data and remain explicit.

Never delete, rewrite, migrate, or bulk-transform user data without explicit authorization and an appropriate safety/backup path.

## Market Data and Request Efficiency

Provider/API efficiency is a permanent product requirement.

- No polling, cron, Realtime subscription, background refresh loop, or fetch-on-hover unless explicitly requested.
- Prefer user-initiated refresh and existing cache-first behavior.
- Reuse loaded data for sorting, filtering, drawers, hover, and other client-side interactions whenever possible.
- Preserve request deduplication and bounded batching.
- Do not add provider calls just to simplify implementation.
- Avoid duplicate initial fetches and request fan-out.
- Superseded requests should use existing abort/generation protections where applicable.
- Opening drawers/modals or changing purely local UI state should not create market requests unless the feature genuinely requires new data.

If a change affects market request behavior, inspect the existing request graph and run the request-ledger checks.

## UI and Responsive Behavior

Put Scanner should remain a compact, premium financial workstation: dense but calm, data-first, precise, and restrained.

- Reuse the existing design system, semantic tokens, shared surfaces, tables, controls, overlays, and responsive patterns.
- Do not introduce a large third-party UI system unless explicitly requested.
- Prefer hierarchy, alignment, grouping, and subtle separators over adding more cards.
- Do not solve density by making important text excessively small.
- Use tabular numerals where financial comparison benefits.
- Preserve clear loading, empty, stale, partial, unavailable, and error states.
- Mobile/iOS is a deliberate product layout, not compressed desktop.
- Maintain practical touch targets, safe-area behavior, keyboard/input usability, and phone-landscape support.
- Avoid page-level horizontal overflow and overlay clipping.

For meaningful UI changes, inspect the rendered result rather than judging only from source code.

## Cross-Surface Regression Awareness

Changes to shared financial or UI behavior may affect:
- Scanner
- Screener
- Watchlist
- Portfolio
- Portfolio Analytics
- ticker/ETF detail
- Option Drawer
- ETF Pulse
- Account

Audit only the surfaces reasonably affected by the change, but do not assume a shared helper is isolated to the page where the bug was reported.

## Testing

Testing should be proportional to the change.

- Run the narrowest existing tests that exercise the changed behavior first.
- Extend an existing relevant test before creating a new test framework or broad test file.
- Add tests for changed user-observable behavior, financial correctness, persistence safety, or meaningful regression risk.
- Do not create unrelated coverage merely to make the task look thorough.
- Never weaken assertions or use passing tests to justify incorrect behavior.

Use existing broader checks when relevant:
- Request/API behavior changed → run `npm run request:ledger`.
- Cross-site/responsive UI changed → run `npm run responsive:check`.
- Broad or high-risk work → run `npm run verify` and `npm run build:report` as appropriate.
- Cloud/persistence changes → run the relevant account/cloud/backup regression suite.
- Financial metric changes → run deterministic metric regressions across affected surfaces.

If a required check cannot run, report that plainly.

## Pause Before Expanding Scope

If the task has not explicitly authorized it, stop and ask before:
- materially expanding into unrelated files or product areas;
- adding a dependency, service, framework, provider, or new infrastructure;
- changing a public API, database schema, durable storage format, or cloud architecture;
- deleting or rewriting user data;
- changing financial formulas or historical-data semantics;
- replacing a bounded request path with a more expensive one;
- keeping two materially different implementations of the same behavior.

Read-only investigation is always allowed.

## Git and Repository Safety

- Inspect `git status` before editing.
- Never discard, reset, overwrite, or silently incorporate unrelated uncommitted user work.
- Keep the diff focused on the requested task.
- Do not amend/rewrite existing history unless explicitly requested.
- Commit/push only when the user/task asks for it.
- Never include secrets, service-role keys, credentials, or user financial data in source, fixtures, logs, or commits.

## Done Means

A task is complete when:
- the requested behavior works;
- the root cause is addressed;
- relevant regressions are checked;
- request, financial, persistence, and UI invariants remain intact where applicable;
- every touched file is necessary to the requested outcome;
- no unnecessary new framework or abstraction was introduced;
- limitations or unverified runtime behavior are stated plainly.

Stop when the task is done. Do not turn a completed request into a future-proofing project.