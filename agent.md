# OLVEX — Codex Agent Instructions

## Project
OLVEX is a Turkish multi-tenant business management SaaS.

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Cloudflare Pages Functions
- Database: Cloudflare D1 / SQLite
- Build: Node.js and esbuild
- Hosting: Cloudflare Pages
- Repository: byskybrisem/OLVEX

## Primary objective

Implement requested features safely, while minimizing unnecessary repository exploration and repeated context loading.

Never sacrifice correctness, security, or testing to reduce token usage.

## Repository map

| Area | Important paths |
|---|---|
| Landing page | `index.html`, `assets/landing.js` |
| Main application | `app.html`, `assets/app.js` |
| Application views | `assets/views.js` |
| Forms | `assets/forms.js`, `assets/editor.js` |
| Sales and purchases | `assets/orders.js` |
| CSV imports | `assets/csv.js` |
| Frontend utilities | `assets/ui.js` |
| Authentication | `functions/api/auth/` |
| Workspace API | `functions/api/workspace/[businessId]/[section].js` |
| POS API | `functions/api/pos.js` |
| Inventory and orders | `functions/_lib/inventory.js` |
| Branch management | `functions/_lib/branches.js` |
| POS identity | `functions/_lib/pos-identity.js` |
| AI operations | `functions/_lib/ai.js` |
| Reporting | `functions/_lib/reports.js` |
| Authorization and transactions | `functions/_lib/workspace.js` |
| Database migrations | `migrations/` |
| Automated tests | `tests/` |
| Build script | `scripts/build.mjs` |
| Project documentation | `README.md` |

This map is a navigation guide, not a substitute for inspecting relevant current code.

## Token-efficient workflow

1. At the beginning of each task, check the current Git branch, working tree status, and relevant recent changes.
2. Read this file and the task requirements first.
3. Identify the smallest relevant set of files using the repository map.
4. Search for relevant symbols, imports, routes, and call sites before opening entire files.
5. Prefer targeted file reads and bounded search results over full repository dumps.
6. Do not repeatedly reread unchanged files without a specific reason.
7. Reuse findings already established in the current conversation when still valid.
8. Use `git diff` to inspect modifications instead of reopening the entire project.
9. Expand exploration when dependencies, data flows, or security implications require it.
10. Never assume that a cached summary or earlier finding reflects the current code without checking relevant changes.

## Business invariants

- Every business must be isolated from other businesses.
- Every branch-specific stock operation must use the correct business and branch.
- Stock cannot be deducted from another branch by accident.
- Repeated POS requests must not create duplicate sales.
- Different physical registers may use the same receipt number without becoming the same transaction.
- Sales, inventory changes, payments, returns, and cancellations must preserve transactional consistency.
- Monetary amounts are stored in minor currency units where required by the existing implementation.
- Authorization must be enforced on the server, not only in the UI.
- AI-generated actions must require the appropriate user confirmation and authorization.
- Existing user accounts, sessions, business records, and transaction history must be preserved.

## Database safety

- Inspect existing migrations before creating new migrations.
- Never assume a production database is empty.
- Prefer additive, backward-compatible migrations.
- Test migrations against isolated D1 databases.
- Preserve historical records and foreign-key integrity.
- Never execute production migrations without explicit authorization.
- Never delete or overwrite production data.

## Testing

Project requirements: Node.js 22.13 or newer.

Run appropriate checks:

```bash
npm ci
npm run build
npm test
npm run test:browser
```

For small changes, prioritize relevant tests during development, then run the full required suite before reporting readiness.

Do not claim a test passed unless it was actually executed successfully.

## Git workflow

- Respect the currently assigned task branch.
- Do not overwrite unrelated changes.
- Do not merge pull requests automatically.
- Do not deploy to production without explicit authorization.
- Do not create duplicate tasks or repeat completed work.
- Preserve the history of the existing PR.

## Reporting

After completing work, provide a concise Turkish report containing:

- What changed
- Which files changed
- Tests actually executed and their results
- Remaining issues and risks
- Whether the PR is ready for review

Avoid repeating the full repository analysis unless the underlying architecture changed.

## Important

Efficiency means reading the right information, not skipping essential verification.

Correctness, security, tenant isolation, and data integrity always take priority over token savings.
