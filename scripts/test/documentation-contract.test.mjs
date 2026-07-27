import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

test("user documentation exposes the complete design-first command chain", () => {
  const readme = read("README.md");
  const usage = read("docs/usage.md");
  for (const command of [
    "design:prepare-source",
    "design:check",
    "design:revise",
    "delivery:prepare",
    "delivery:check-presentation",
    "presentation:probe",
    "accept",
  ]) assert.ok(usage.includes(command), `usage guide is missing ${command}`);
  assert.match(readme, /Design\.md/);
  assert.match(readme, /LibreOffice/);
  assert.match(readme, /Poppler/);
  const designIndex = usage.indexOf("Design.md");
  const tokensIndex = usage.indexOf("design-tokens.json");
  assert.ok(designIndex >= 0 && tokensIndex > designIndex);
  assert.match(usage, /audit\/design\/contract-lock\.json/);
  assert.match(usage, /presentation\/design-system\.pptx/);
  assert.match(usage, /退出码.*`3`.*(?:未验证|不可交付)/s);
});

test("maintainer documentation records operations, ownership, and migration", () => {
  const development = read("docs/development.md");
  assert.match(development, /design_specification/);
  assert.match(development, /prepare.*finalize/s);
  assert.match(development, /package_format_version/);
  assert.match(development, /contract_revision/);
  assert.match(development, /director-review\.json/);
  assert.match(development, /单一所有者|single owner/i);
});

test("base specification delegates the active extension instead of promising future PPT work", () => {
  const base = read("docs/superpowers/specs/2026-07-24-design-agent-system-design.md");
  const extension = read("docs/superpowers/specs/2026-07-26-delivery-artifacts-design.md");
  assert.doesNotMatch(base, /后续将它们实现为独立输出 Skill/);
  assert.match(base, /2026-07-26-delivery-artifacts-design\.md/);
  assert.match(base, /package_format_version.*3/s);
  assert.match(extension, /状态：已实现，待端到端验收/);
});
