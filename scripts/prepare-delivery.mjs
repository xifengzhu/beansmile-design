#!/usr/bin/env node
import { resolve } from "node:path";
import { buildDeliverySource } from "./lib/design-source.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pkg = arg("--package");
if (!pkg) {
  console.error("用法: node scripts/prepare-delivery.mjs --package <目录> [--overwrite]");
  process.exit(2);
}

try {
  const root = resolve(pkg);
  const manifest = buildDeliverySource(root, { overwrite: process.argv.includes("--overwrite") });
  console.log(`✓ 已冻结最终 Design.md 来源 → ${root}/audit/delivery/source-manifest.json`);
  console.log(`  prototype=${manifest.artifact_version}, digest=${manifest.source_bundle_digest}`);
} catch (error) {
  console.error(`✗ 最终 Design.md 来源冻结失败: ${error.message}`);
  process.exit(1);
}
