# OLVEX — Claude Code project instructions

These instructions apply when working in `byskybrisem/OLVEX`. Read `AGENTS.md` and relevant sections of `README.md` before changing code. If instructions conflict, preserve data, security, and explicit user approval requirements.

## Product and architecture

- OLVEX is a Turkish multi-tenant business management SaaS. Its UI and user-facing reports should be in Turkish.
- Frontend: HTML, CSS and vanilla JavaScript; backend: Cloudflare Pages Functions; database: Cloudflare D1 (SQLite); build: Node.js 22.13+ and esbuild; deployment: Cloudflare Pages.
- Find current source locations using `AGENTS.md`, the repository, and Graphify. Never treat an old index as the final source of truth.
- Preserve existing customers, businesses, sessions, stock movements, financial records, subscriptions, and all working integrations.

## Mandatory MCP workflow: Graphify first

The project-level MCP server is declared in `.mcp.json` as `graphify`.

1. At the start of repository-wide analysis, confirm Graphify is connected and that the indexed repository is `byskybrisem/OLVEX`. Verify the index is sufficiently current.
2. Before broad file scans, query Graphify for relevant functions, callers, imports, dependency paths, module ownership, and change impact. Use only the tools actually exposed by the connected server.
3. For a requested change, map the affected route/UI/data paths and identify adjacent tests before editing.
4. Open and verify the actual relevant files afterward. Graphify may not include uncommitted changes, recent commits, runtime configuration, or all implementation details.
5. If Graphify is absent, unauthorized, stale, or incomplete, explain the limitation and fall back to targeted repository inspection. Never invent graph results or say the tool was used when it was not.

Avoid needlessly reading the entire repository or repeating identical graph searches.

## Mandatory MCP workflow: Context7 for documentation

The project-level MCP server is declared in `.mcp.json` as `context7`.

1. Before using or changing framework, library, SDK, API, or integration behavior, check the versions actually present in the repository (including `package.json` and the lockfile).
2. Resolve the relevant library using Context7 and consult version-appropriate documentation and examples before implementation.
3. Especially verify Cloudflare Pages Functions, D1, Wrangler, esbuild, Playwright, the chosen AI provider, and billing integrations when the task touches them.
4. Treat official provider documentation as authoritative for platform-specific behavior that Context7 cannot cover; reconcile documentation with the installed version and actual code.
5. If Context7 is unavailable, state that clearly and use official documentation or local source inspection. Do not fabricate citations, API support, or tool calls.

Graphify answers **where/how OLVEX code connects**; Context7 answers **how the actual external technology works**. Use both where relevant, but never as substitutes for source inspection and tests.

## MCP connection checks

- Project MCP endpoints are in `.mcp.json`. Do not hardcode credentials or tokens in git.
- In Claude Code, inspect `/mcp` and complete any required approval/sign-in for Graphify and Context7.
- A declared MCP server is not proof of a working connection. Confirm by successfully querying the intended service.
- Graphify must have permission to access the correct indexed repository. Report missing access instead of silently switching to another repository.

## Git, production, and rollback safety

- Before any substantive work, inspect `git status`, branch, recent changes, and the base commit SHA.
- Do not commit directly to `main` for redesigns or broad changes. Work in a dedicated feature branch and propose a pull request.
- Do not merge pull requests or publish to production without the user's explicit approval.
- Never alter production D1, run production migrations, expose secrets, or execute real financial transactions without separate explicit approval.
- Use an isolated preview D1 for tests. Prefer additive, reversible, backward-compatible migrations and document the rollback impact.
- Do not delete or overwrite existing production data. Code rollback and database rollback are separate concerns.
- Keep the original working version recoverable and document how to abandon the proposed branch safely.

## Business invariants

- Strictly isolate every business and its branches at the API/database level. Never trust client-supplied authorization alone.
- Preserve atomicity and idempotency of sales, POS sync, returns, stock mutations, and payments.
- Keep amounts and currency-unit conventions consistent with existing implementation.
- AI must not execute consequential actions without the existing authorization and user approval flow.
- Preserve real payment/subscription semantics; do not replace them with mocks outside isolated tests.
- Treat account security, password/session handling, privacy, and auditability as critical.

## UI and product quality

- Aim for a polished, usable, responsive business SaaS, not decorative mockups.
- Respect existing OLVEX brand direction: dark interface, controlled glass effects, purple `#635BFF` and teal `#12B8A6`; improve readability, hierarchy, contrast, and mobile usability.
- Preserve functionality while redesigning. Use real backed-by-API data, honest empty/error/loading states, keyboard/accessibility support, and consistent navigation.
- Never call an unfinished screen, fake metric, simulated payment, or placeholder integration "working."

## Checks before marking work complete

Use task-specific tests during development and run appropriate full checks before claiming readiness:

```bash
npm ci
npm run build
npm test
npm run test:browser
npm run test:browser:branches
npm run test:browser:admin
```

Browser tests need Chromium and a suitable local test environment. Report commands you actually executed, with pass/fail/blocked status; do not claim unrun checks passed.

## Delivery style

- Work autonomously on safe, reversible changes; ask for approval on production, data-destructive, paid, or irreversible actions.
- Give short, clear Turkish updates only when helpful.
- Final response: changed files, main implementation decisions, actual test results, remaining risks, branch/PR link, and precise rollback instructions.
- Prefer verified facts over confident guesses. If a tool, service, test, or environment is unavailable, say so explicitly.
