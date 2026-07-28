// 浏览器启动与能力探测。多策略解析可执行文件；probeBrowser 真正试启动一次，
// 如实反映本环境是否具备浏览器自动化（规范 6.1/6.2），绝不靠"模块已安装"就宣称可用。
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let _playwright = null;
async function getChromium() {
  if (!_playwright) {
    try { _playwright = (await import("playwright")).chromium; }
    catch { _playwright = false; }
  }
  return _playwright;
}

// 在 ms-playwright 缓存里找一个 Chrome for Testing 可执行文件。
function cachedExecutable() {
  const base = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac", "chrome-linux", "chrome-win"]) {
      for (const bin of [
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome", "chrome.exe",
      ]) {
        const p = join(base, dir, arch, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

// 依次尝试的启动策略。
function strategies() {
  const list = [{ name: "system-chrome", opts: { channel: "chrome" } }];
  const cached = cachedExecutable();
  if (cached) list.push({ name: "cached-chromium", opts: { executablePath: cached } });
  list.push({ name: "bundled-chromium", opts: {} });
  return list;
}

export async function launchBrowser() {
  const chromium = await getChromium();
  if (!chromium) throw new Error("playwright 模块不可用");
  const errors = [];
  for (const s of strategies()) {
    try {
      const browser = await chromium.launch({
        headless: true,
        timeout: 8000,
        args: ["--no-sandbox", "--allow-file-access-from-files"],
        ...s.opts,
      });
      return { browser, method: s.name };
    } catch (e) { errors.push(`${s.name}: ${String(e.message).split("\n")[0]}`); }
  }
  throw new Error(`所有启动策略失败：\n  ${errors.join("\n  ")}`);
}

let _probe = null;
export async function probeBrowser() {
  if (_probe) return _probe;
  try {
    const { browser, method } = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html lang=en><title>probe</title><body><h1>ok</h1></body></html>");
    const ok = (await page.$("h1")) !== null;
    await browser.close();
    _probe = { available: ok, method, error: null };
  } catch (e) {
    _probe = { available: false, method: null, error: String(e.message).split("\n")[0] };
  }
  return _probe;
}
