import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser, probeBrowser } from "../lib/browser.mjs";

const require = createRequire(import.meta.url);
const probe = await probeBrowser();

test("axe can inspect a file prototype with a linked local stylesheet", async (t) => {
  if (!probe.available) return t.skip(`browser unavailable: ${probe.error}`);

  const dir = mkdtempSync(join(tmpdir(), "browser-file-assets-"));
  writeFileSync(join(dir, "styles.css"), "body { color: #111; background: #fff; }");
  writeFileSync(join(dir, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local assets</title>
<link rel="stylesheet" href="styles.css"></head><body><main><h1>Ready</h1></main></body></html>`);

  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(`resource failed: ${request.url()}`));

    await page.goto(pathToFileURL(join(dir, "index.html")).href, { waitUntil: "load" });
    await page.addScriptTag({ path: require.resolve("axe-core") });
    await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
