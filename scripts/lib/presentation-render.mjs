import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import {
  basename,
  delimiter,
  dirname,
  join,
  resolve,
} from "node:path";
import { sha256Bytes, sha256File } from "./hash.mjs";
import { safePackagePath } from "./paths.mjs";

const execFileAsync = promisify(execFile);
const REQUIRED_QA_CHECKS = Object.freeze(["overlap", "clipping", "title_wrap", "font_substitution"]);
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 校验通过时返回文件字节，供调用方直接哈希，避免每张 render 读盘两次。
function assertValidPng(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`PNG render 非法或为空: ${path}`);
  }

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let sawIhdr = false;
  let sawIend = false;
  const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(`PNG chunk 截断: ${path}`);
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + length;
    const next = crcStart + 4;
    if (next > bytes.length) throw new Error(`PNG chunk 长度非法: ${path}`);
    const type = bytes.toString("ascii", typeStart, dataStart);
    const expectedCrc = bytes.readUInt32BE(crcStart);
    if (crc32(bytes.subarray(typeStart, crcStart)) !== expectedCrc) {
      throw new Error(`PNG chunk CRC 非法: ${path}`);
    }
    const data = bytes.subarray(dataStart, crcStart);
    if (type === "IHDR") {
      if (sawIhdr || offset !== 8 || length !== 13) throw new Error(`PNG IHDR 非法: ${path}`);
      sawIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) throw new Error(`PNG IEND 非法: ${path}`);
      sawIend = true;
    }
    offset = next;
  }

  const channels = PNG_CHANNELS[colorType];
  if (!sawIhdr || !sawIend || !width || !height || !channels || !idat.length || interlace !== 0) {
    throw new Error(`PNG render 结构不完整或不受支持: ${path}`);
  }
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  let pixels;
  try {
    pixels = inflateSync(Buffer.concat(idat));
  } catch {
    throw new Error(`PNG pixel 数据无法解压: ${path}`);
  }
  if (pixels.length !== height * (rowBytes + 1)) throw new Error(`PNG pixel 数据长度非法: ${path}`);
  for (let row = 0; row < height; row += 1) {
    if (pixels[row * (rowBytes + 1)] > 4) throw new Error(`PNG filter 非法: ${path}`);
  }
  return bytes;
}

function executable(path) {
  if (!path) return null;
  try {
    accessSync(path, constants.X_OK);
    return resolve(path);
  } catch {
    return null;
  }
}

function findExecutable(names, pathValue) {
  for (const directory of String(pathValue ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const found = executable(join(directory, name));
      if (found) return found;
    }
  }
  return null;
}

export function resolvePresentationTools(options = {}) {
  const pathValue = options.path ?? process.env.PATH;
  const soffice = options.soffice
    ? executable(options.soffice)
    : findExecutable(["soffice", "libreoffice"], pathValue);
  const pdftoppm = options.pdftoppm
    ? executable(options.pdftoppm)
    : findExecutable(["pdftoppm"], pathValue);
  const missing = [!soffice && "soffice/LibreOffice", !pdftoppm && "pdftoppm/Poppler"].filter(Boolean);
  return {
    available: missing.length === 0,
    soffice,
    pdftoppm,
    error: missing.length ? `presentation render tools unavailable: ${missing.join(", ")}` : null,
  };
}

function atomicReplaceDirectory(next, destination, tempRoot) {
  const backup = join(dirname(destination), `.tmp-render-backup-${process.pid}-${Date.now()}`);
  let movedExisting = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      movedExisting = true;
    }
    renameSync(next, destination);
    if (movedExisting) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch {
        // Publishing succeeded; a stale backup is safer than reporting a false render failure.
      }
    }
  } catch (error) {
    if (!existsSync(destination) && movedExisting && existsSync(backup)) renameSync(backup, destination);
    throw error;
  } finally {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup must not invalidate an already published render set.
    }
    if (existsSync(backup) && existsSync(destination)) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch {
        // Leave the backup for later cleanup rather than failing after publication.
      }
    }
  }
}

export async function renderPptx(pptxPath, outDir, tools) {
  if (!tools?.available || !tools.soffice || !tools.pdftoppm) {
    throw new Error(tools?.error ?? "presentation render tools unavailable");
  }
  if (!existsSync(pptxPath)) throw new Error(`PPTX 不存在: ${pptxPath}`);

  const parent = dirname(outDir);
  mkdirSync(parent, { recursive: true });
  const tempRoot = mkdtempSync(join(parent, ".tmp-render-"));
  const converted = join(tempRoot, "converted");
  const raw = join(tempRoot, "raw");
  const next = join(tempRoot, "next");
  mkdirSync(converted);
  mkdirSync(raw);
  mkdirSync(next);

  try {
    await execFileAsync(tools.soffice, [
      `-env:UserInstallation=${pathToFileURL(join(tempRoot, "libreoffice-profile")).href}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      converted,
      pptxPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
    const convertedPdf = join(converted, basename(pptxPath).replace(/\.pptx$/i, ".pdf"));
    if (!existsSync(convertedPdf)) throw new Error("LibreOffice 未生成 PDF");
    const pdf = { sha256: sha256File(convertedPdf), retained: false };

    const rawPrefix = join(raw, "page");
    await execFileAsync(tools.pdftoppm, ["-png", "-r", "144", convertedPdf, rawPrefix], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const pages = readdirSync(raw)
      .map((name) => ({ name, match: name.match(/^page-([0-9]+)\.png$/) }))
      .filter((entry) => entry.match)
      .map((entry) => ({ name: entry.name, number: Number(entry.match[1]) }))
      .sort((left, right) => left.number - right.number);
    if (!pages.length) throw new Error("pdftoppm 未生成 PNG renders");
    if (pages.some((page, index) => page.number !== index + 1)) {
      throw new Error("pdftoppm PNG 页码不连续");
    }

    const stagedRenders = pages.map((page, index) => {
      const path = join(next, `slide-${index + 1}.png`);
      copyFileSync(join(raw, page.name), path);
      return { slideNumber: index + 1, sha256: sha256Bytes(assertValidPng(path)) };
    });
    atomicReplaceDirectory(next, outDir, tempRoot);
    const renders = stagedRenders.map((render) => ({
      ...render,
      path: join(outDir, `slide-${render.slideNumber}.png`),
    }));
    return { pdf, renders };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function sameNumberSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((number) => actual.includes(number));
}

function canonicalGeneratedAt(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function presentationQaIssues(root, inspected, qa, directorReview) {
  const issues = [];
  if (!inspected || typeof inspected !== "object" || !Array.isArray(inspected.slides)) {
    return ["presentation inspection 结果非法"];
  }
  if (!qa || typeof qa !== "object" || Array.isArray(qa)) return ["audit/presentation/qa.json 必须为对象"];

  const expectedSlides = inspected.slides.map((slide, index) => slide?.number ?? index + 1);
  if (qa.pptx_sha256 !== inspected.pptxSha256) issues.push("qa.pptx_sha256 与当前 PPTX SHA 不符");
  if (qa.slide_count !== expectedSlides.length) issues.push("qa slide_count 与 PPTX 页数不符");

  const renders = Array.isArray(qa.renders) ? qa.renders : [];
  if (!Array.isArray(qa.renders)) issues.push("qa.renders 必须为数组");
  const renderNumbers = renders.map((render) => render?.slide_number);
  if (!sameNumberSet(renderNumbers, expectedSlides)) issues.push("qa renders 未精确覆盖 PPTX slide 页码");
  for (const render of renders) {
    const expectedPath = `audit/presentation/rendered/slide-${render?.slide_number}.png`;
    if (render?.path !== expectedPath) issues.push(`slide ${render?.slide_number ?? "unknown"} render path 非法`);
    const fullPath = safePackagePath(root, render?.path);
    if (!fullPath || !existsSync(fullPath)) {
      issues.push(`slide ${render?.slide_number ?? "unknown"} render 缺失`);
    } else {
      try {
        if (!lstatSync(fullPath).isFile()) {
          issues.push(`slide ${render?.slide_number ?? "unknown"} render path 必须是 package 内普通文件`);
        } else if (render?.sha256 !== sha256Bytes(assertValidPng(fullPath))) {
          issues.push(`slide ${render.slide_number} render SHA/hash 漂移`);
        }
      } catch (error) {
        issues.push(`slide ${render?.slide_number ?? "unknown"} render 无法读取或 PNG 非法: ${error.message}`);
      }
    }
  }

  for (const check of REQUIRED_QA_CHECKS) {
    if (qa?.checks?.[check] !== "pass") issues.push(`qa check ${check} 未通过或 unverified`);
  }
  if (qa.status !== "pass") issues.push("qa status 未通过或 unverified");
  if (typeof qa?.tools?.soffice !== "string" || !qa.tools.soffice.trim()) {
    issues.push("qa tools 缺 soffice renderer identity");
  }
  if (typeof qa?.tools?.pdftoppm !== "string" || !qa.tools.pdftoppm.trim()) {
    issues.push("qa tools 缺 pdftoppm renderer identity");
  }
  if (qa.checker !== "presentation-qa-v1") issues.push("qa checker identity 非法");
  if (!canonicalGeneratedAt(qa.generated_at)) {
    issues.push("qa generated_at 输出时间非法");
  }
  const slideQa = Array.isArray(qa.slides) ? qa.slides : [];
  if (!Array.isArray(qa.slides)) issues.push("qa slides 逐页状态必须为数组");
  const slideQaNumbers = slideQa.map((entry) => entry?.slide_number);
  if (!sameNumberSet(slideQaNumbers, expectedSlides)) issues.push("qa slides 逐页状态未精确覆盖 PPTX 页码");
  for (const entry of slideQa) {
    if (entry?.status !== "pass") issues.push(`qa slide ${entry?.slide_number ?? "unknown"} status 未通过或 unverified`);
    if (!Array.isArray(entry?.manual_items)) {
      issues.push(`qa slide ${entry?.slide_number ?? "unknown"} manual_items 必须为数组`);
    } else if (entry.manual_items.length) {
      issues.push(`qa slide ${entry.slide_number} 仍有未处理 manual/人工检查项`);
    }
  }

  if (!directorReview || typeof directorReview !== "object" || Array.isArray(directorReview)) {
    issues.push("audit/presentation/director-review.json 缺失");
  } else {
    if (directorReview.completed !== true) issues.push("Director slide review 未 completed");
    if (directorReview.pptx_sha256 !== inspected.pptxSha256) issues.push("Director review 绑定旧 PPTX SHA");
    if (!Array.isArray(directorReview.reviewed_slide_numbers)) {
      issues.push("Director reviewed_slide_numbers 必须为数组");
    } else if (!sameNumberSet(directorReview.reviewed_slide_numbers, expectedSlides)) {
      issues.push("Director 逐页复核页码缺失、重复或含额外 slide");
    }
    if (!Array.isArray(directorReview.findings)) {
      issues.push("Director findings 必须为数组");
    } else if (directorReview.findings.length) {
      issues.push("Director findings 仍有未处理问题");
    }
  }
  return [...new Set(issues)];
}
