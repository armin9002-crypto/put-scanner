# Native Codex delegation

The primary model remains selected by the user. These project agents work with any capable primary; only [astra.md](astra.md) adds Astra-specific guidance. No application integration, dependencies, hooks, user-level changes, or feature flags are required.

| Agent | Model | Reasoning | Access expectation | Use |
| --- | --- | --- | --- | --- |
| [fast_worker](../../.codex/agents/fast_worker.toml) | `gpt-5.6-luna` | `low` | Scoped edits within inherited permissions | Mechanical/presentation edits, exact fixtures/types, parent-specified tests |
| [explorer](../../.codex/agents/explorer.toml) | `gpt-5.6-luna` | `medium` | Read-only | Targeted caller/data-flow traces, helpers, tests, affected surfaces |
| [general_worker](../../.codex/agents/general_worker.toml) | `gpt-5.6-terra` | `medium` | Scoped edits within inherited permissions | Interconnected implementation or integration tests after architecture is decided |
| [reviewer](../../.codex/agents/reviewer.toml) | `gpt-5.6-sol` | `high` | Read-only | Independent consequential-change correctness review |

Terra covers work beyond a small mechanical Luna task without requiring Sol for all implementation. Model tiers here are routing choices, not a guarantee of savings on every task. Spawn/coordination and duplicated context cost tokens; do trivial tasks directly and avoid multiple agents editing the same files. Reviewers are for meaningful risk, not a mandatory finishing ritual.

## Invocation and context

Open Codex at the Git repository root (`put-scanner/`, not its enclosing folder). Ask the primary to use a role by its exact name, for example: "Use explorer to locate the consumers of exact-contract identity; return paths and tests without edits." Codex selects the named custom agent through its available native spawn interface. The custom `explorer` intentionally replaces the built-in role of that name. Start a new session if an existing client has not refreshed discovery.

Give a bounded objective, relevant paths and constraints, already-decided semantics, acceptance criteria, and requested output. Prefer fresh context for small tasks; include necessary domain invariants and decisions rather than a whole task history. Keep the primary product decisions in AGENTS.md with the primary, even when a worker implements them.

Some hosted chat interfaces expose `collaboration.spawn_agent` with `task_name`, `message`, `model`, `reasoning_effort`, and `fork_turns`, but no custom-role selector. In that interface, read the chosen TOML and explicitly pass its model/effort and instructions in the bounded task. A task name alone does not load a role. Use `fork_turns="none"` for fresh context or a positive integer string for selected recent turns; full-history `"all"` inherits the primary model/effort and cannot take overrides. This is an invocation choice, not an invented TOML context key. Follow the actual tool schema if another client differs.

Workers must not recursively delegate under these role instructions. The current chat runtime technically allows children to spawn and shares four total concurrency slots including the root; do not assume that capacity or recursive behavior in other clients. Leave native concurrency defaults alone. Explorer/reviewer specify `sandbox_mode="read-only"` and prohibit writes in their instructions; parent live permission overrides can supersede custom sandbox defaults, so these files are not an immutable permission boundary.

## Capability and validation record

Checked September 13, 2026 against [official custom-agent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents), the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), installed Codex `0.154.0-alpha.6.2`, and this session's live spawn schema.

- Native project location is `.codex/agents/*.toml`. Required fields are `name`, `description`, and `developer_instructions`; explicit `model` and `model_reasoning_effort` select each role's configuration. No registration table or `.codex/config.toml` is necessary here.
- Installed `codex features list` reports `multi_agent` stable/enabled. The bundled catalog (`codex debug models --bundled`) and live spawn schema list all three exact model IDs and chosen efforts. No legacy enable flag was added.
- All four files were parsed as TOML and checked against that catalog. Existing instruction cleanup and unrelated work were preserved; only configuration/documentation changed. Application tests are unnecessary for this scope.
- Local Codex strict configuration loading succeeded via app-server `config/read`. This does not prove custom-role discovery: the exposed read endpoint does not list standalone roles, and the chat spawn interface has no role selector. The sandboxed CLI has no login credentials and cannot reach provider endpoints, so authenticated native role discovery/execution remains unverified. No credentials were copied or user configuration changed to bypass this limitation.
- A real fresh-context Luna/medium smoke task read the Explorer file and found `src/lib/optionMarketIntegrity.ts`, `assessPutOptionSurface()`, and `tests/option-market-integrity.test.mjs`. This verifies scoped Luna execution with explicitly supplied settings, not automatic loading of a named custom agent. Fast Worker, Terra, and Reviewer inference were not separately run.

For a native discovery smoke check in an authenticated local session, ask: "Spawn the configured explorer to identify the canonical option-market-integrity module. Return its path and one symbol; no writes or further agents." Inspect the child model/effort and confirm `gpt-5.6-luna` / `medium`. If the client cannot discover the roles, report the limitation rather than silently claiming the named configuration ran.

## Examples

1. Primary alone: fix a typo in one UI label and inspect the diff.
2. Luna: apply a parent-decided spacing adjustment to three named components, preserving behavior and running the specified checks.
3. Consequential work: Explorer traces a Portfolio CAS path and protecting tests; the primary decides the correction, General Worker implements that decision in assigned files, and Reviewer independently audits conflict/data-preservation behavior. The primary resolves findings, integrates, and completes final verification.
