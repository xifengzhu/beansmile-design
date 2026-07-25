# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js 18+ ESM runtime for design agents; it has no build step. Agent instructions live in `skills/<name>/SKILL.md`, with canonical roles registered in `skills/registry.yaml`. Executable enforcement is under `scripts/`: shared logic belongs in `scripts/lib/`, and tests in `scripts/test/`. Versioned standards and industry rules live in `evidence/rules/`; adversarial detector samples are in `fixtures/blockers/`. Schemas are under `docs/superpowers/specs/schemas/`, and native-platform checklists are in `templates/native-checklists/`. Generated delivery packages belong in ignored `outputs/`.

## Build, Test, and Development Commands

- `npm install`: install runtime and browser-testing dependencies.
- `npm run check`: validate the rule library, five flow manifests, and role registry.
- `npm test`: run all `node:test` suites in `scripts/test/*.test.mjs`.
- `node --test scripts/test/gates.test.mjs`: run one focused test file.
- `npm run validate:rules`: validate rule schemas, IDs, and conflict references.
- `npm run env:check`: launch a real browser to verify Playwright and axe-core availability.
- `npm run recall -- --out /tmp/recall.json`: measure blocker recall and false positives.

See `README.md` for delivery-package commands such as `init`, `browser:check`, `snapshot`, and `accept`.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, ESM imports, and `.mjs` files. Prefer small, deterministic functions and existing helpers over new abstractions. JavaScript identifiers use `camelCase`; internal Skill IDs use canonical `snake_case` (for example, `html_prototype`), while Skill directories use kebab-case (`html-prototype`). Keep YAML rule IDs stable. A Skill promise must have corresponding script enforcement; update manifests, schemas, runtime checks, and tests together.

## Testing Guidelines

Name tests `*.test.mjs`. Add both positive and adversarial cases for gates, hashes, findings, scenarios, and rule coverage. Detector changes should update `fixtures/blockers/manifest.yaml` when introducing a new category. Before submitting, run `npm run check && npm test && npm run validate:rules`. Browser-command exit code `3` means degraded and unverified, never passed.

## Architecture & Agent Rules

`context.yaml` is each delivery package's single source of truth and is updated only through Director-controlled gates. Reviewers remain read-only and operate on immutable versioned snapshots. Changing a reviewed prototype or token file requires a new artifact version, screenshots, browser checks, snapshot, and both reviews.

## Commit & Pull Request Guidelines

Use focused Conventional Commit subjects matching history, such as `feat: harden diff gate`, `docs: add project README`, or `test: cover stale findings`. Pull requests should explain the reason, affected contracts, and validation commands. Link relevant issues; include screenshots or audit evidence for prototype/browser changes, and explicitly report any degraded checks.
