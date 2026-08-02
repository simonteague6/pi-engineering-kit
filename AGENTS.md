<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-08-02 | Last verified: 2026-08-02 -->

# AGENTS.md

**Precedence:** the **closest `AGENTS.md`** to the files you're changing wins. Root holds global defaults only.

## Project
- `pi-engineering-kit` is a Pi package; extensions live in `extensions/` and bundled agent definitions live in `agents/`.
- The package adapts Matt Pocock's engineering skills; skills own judgment and extensions own mechanics.
- Pi package/runtime behavior is documented in the installed Pi docs referenced by `README.md`; do not assume generic Node APIs apply.

## Commands
> Source: `README.md` and `package.json`. Re-run the failing checks after fixing the stale test import.

<!-- AGENTS-GENERATED:START commands -->
| Task | Command | Status |
|------|---------|--------|
| Install | `bun install` | verified |
| Typecheck | `bunx tsc --noEmit` | currently fails: missing `extensions/total-ctx-usage.ts` |
| Tests | `bun test` | currently fails: 18 pass, 1 stale-import error |
<!-- AGENTS-GENERATED:END commands -->

> There is no configured lint, format, build, or package test script. Do not document or run `npx eslint`/`npx prettier` unless those tools are added.

## Response Style
- Answer first, elaborate only if needed. No sycophantic openers ("Great question!", "Absolutely!").
- For yes/no or status questions, lead with the answer.
- Skip preamble. Match response length to task complexity.

## Workflow
1. **Before coding**: Read the nearest `AGENTS.md`, then inspect the relevant issue/spec and domain docs.
2. **After each change**: Run the smallest relevant check; use `bun test <path>` for a focused test and `bunx tsc --noEmit` for TypeScript changes.
3. **Before committing**: Run `bun test` and `bunx tsc --noEmit`; report the known stale-import failure if it remains.
4. **Before claiming done**: Run verification and **show output as evidence** — never say "try again", "should work now", "tested", "verified", or "all green" without pasted command output in the same turn.

## Project docs
- `CONTEXT.md` is the domain vocabulary for session handoffs.
- `docs/agents/issue-tracker.md` defines GitHub issue operations and wayfinding conventions.
- `docs/agents/triage-labels.md` defines canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.
- `docs/agents/domain.md` explains which domain docs and ADRs to consult.
- `docs/research/` holds cited research findings; preserve source links when updating them.

## File Map
<!-- AGENTS-GENERATED:START filemap -->
```
agents/          → documentation
extensions/      → TypeScript modules
tests/           → test suites
docs/            → documentation
```
<!-- AGENTS-GENERATED:END filemap -->

## Heuristics (quick decisions)
<!-- AGENTS-GENERATED:START heuristics -->
| When | Do |
|------|-----|
| Adding tests | Create in `tests/` directory |
| Merging PRs | Squash and merge |
| Adding dependency | Ask first - we minimize deps |
| Unsure about pattern | Check Golden Samples above |
<!-- AGENTS-GENERATED:END heuristics -->

## Repository Settings
<!-- AGENTS-GENERATED:START repo-settings -->
- **Default branch:** `main`
- **Merge strategy:** squash, merge, rebase
<!-- AGENTS-GENERATED:END repo-settings -->

<!-- AGENTS-GENERATED:START ci-rules -->

<!-- AGENTS-GENERATED:END ci-rules -->

## Boundaries

### Always Do
- Run pre-commit checks before committing
- Add tests for new code paths
- Use conventional commit format: `type(scope): subject`
- Use **atomic commits** (one logical change per commit); preserve signatures, keep bisection useful
- **Show test output as evidence before claiming work is complete** — never say "try again", "should work now", "tested", "verified", or "all green" without pasted command output
- Before any edit, verify `pwd` resolves inside the intended repo worktree — not `.bare/`, not `~/.claude/skills/…`, not `~/.claude/plugins/cache/…` (those are read-only caches that get clobbered on update)
- For upstream dependency fixes: run **full** test suite, not just affected tests
- Force-push only with `--force-with-lease`
- Use TypeScript strict mode with proper type annotations

### Ask First
- Adding new dependencies
- Modifying CI/CD configuration
- Changing public API signatures
- Running full e2e test suites
- Repo-wide refactoring or rewrites
- Operations that touch >3 repos (produce a dry-run plan first)

### Never Do
- Commit secrets, credentials, or sensitive data
- Modify vendor/, node_modules/, or generated files
- Push directly to main/master branch — open a PR
- Merge a PR before all review threads are resolved
- Squash commits during merge or rebase unless the user explicitly asked
- Edit installed skill/plugin cache paths (`~/.claude/skills/`, `~/.claude/plugins/cache/`, `**/.bare/**`) — always the source worktree
- Reply to review comments with bare "Addressed" or "Fixed" — cite the resolving commit SHA
- Delete migration files or schema changes
- Use `secrets: inherit` in reusable GitHub Actions workflows (pass secrets explicitly)
- Commit package-lock.json without package.json changes
- Use any type without justification

## Contributing (for AI agents)
- **Comprehension**: Understand the problem before submitting code. Read the linked issue, understand *why* the change is needed, not just *what* to change.
- **Context**: Every PR must explain the trade-offs considered and link to the issue it addresses. Disclose AI assistance if the project requires it.
- **Continuity**: Respond to review feedback. Drive-by PRs without follow-up will be closed.

<!-- AGENTS-GENERATED:START module-boundaries -->

<!-- AGENTS-GENERATED:END module-boundaries -->

## Codebase State
<!-- AGENTS-GENERATED:START codebase-state -->

- `tests/total-ctx-usage.test.ts` imports the missing `extensions/total-ctx-usage.ts`; the full test suite and typecheck currently fail for this reason.
<!-- AGENTS-GENERATED:END codebase-state -->

## Agent definitions
- Use the narrowest definition in `agents/` for isolated legwork; definitions specify their own tools and output contract.
- `general` is the bounded implementation agent; it is not a planner.
- Keep Standards and Spec reviews separate: `standards-reviewer` checks repository standards, while `spec-reviewer` checks requirement fidelity.
- `primary-source-researcher` is the AFK research definition and writes one cited note under `docs/research/`.
- Interface designers are design alternatives, not implementation agents; use only when the task calls for interface design.

## Issue tracker
Issues and PRDs are tracked in GitHub Issues with `gh`; read `docs/agents/issue-tracker.md` before mutating tracker state.

## Scoped AGENTS.md (MUST read when working in these directories)
<!-- AGENTS-GENERATED:START scope-index -->
- `./tests/AGENTS.md` — Test suites, fixtures, and testing utilities
<!-- AGENTS-GENERATED:END scope-index -->

> **Agents**: When you read or edit files in a listed directory, you **must** load its AGENTS.md first. It contains directory-specific conventions that override this root file.

## When instructions conflict
The nearest `AGENTS.md` wins. Explicit user prompts override files.
- For TypeScript/JavaScript patterns, follow project eslint/prettier config
