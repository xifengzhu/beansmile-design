// 内容哈希与快照 manifest（评审只读/同源门禁的基础，替代对 gitignore 目录无效的 git diff）。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

export function canonicalDigest(value) {
  return sha256Text(JSON.stringify(sortKeysDeep(value)));
}

// 递归列出目录下全部文件（相对 root 的 posix 路径，排序保证确定性）。
export function listFilesRecursive(root, dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFilesRecursive(root, p));
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out.sort();
}

// 对 root 下的一组条目（文件或目录）求 {相对路径: sha256}。不存在的条目跳过。
export function hashPaths(root, items) {
  const files = {};
  for (const it of items) {
    const p = join(root, it);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const rel of listFilesRecursive(p)) files[`${it}/${rel}`] = sha256File(join(p, rel));
    } else {
      files[it] = sha256File(p);
    }
  }
  return files;
}

// manifest 摘要：对 files 做键排序后的规范化 JSON 求哈希，作为快照的单值指纹。
export function manifestDigest(manifest) {
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)));
  return sha256Text(JSON.stringify({ artifact_version: manifest.artifact_version, files: sorted }));
}

// 校验快照目录与其 manifest 一致（不可变性）。返回差异清单，空数组=完好。
export function verifyManifest(snapDir, manifest) {
  const problems = [];
  const actual = {};
  for (const rel of listFilesRecursive(snapDir)) {
    if (rel === "manifest.json") continue;
    actual[rel] = sha256File(join(snapDir, rel));
  }
  for (const [rel, h] of Object.entries(manifest.files)) {
    if (!(rel in actual)) problems.push(`快照缺文件: ${rel}`);
    else if (actual[rel] !== h) problems.push(`快照被篡改: ${rel}`);
  }
  for (const rel of Object.keys(actual)) {
    if (!(rel in manifest.files)) problems.push(`快照多出未登记文件: ${rel}`);
  }
  return problems;
}

// 比较两组哈希表（如 活动产物 vs 快照），返回差异描述。onlyPrefixes 限定比较范围。
export function diffHashMaps(expected, actual, onlyPrefixes = null) {
  const inScope = (rel) => !onlyPrefixes || onlyPrefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
  const problems = [];
  for (const [rel, h] of Object.entries(expected)) {
    if (!inScope(rel)) continue;
    if (!(rel in actual)) problems.push(`被删除: ${rel}`);
    else if (actual[rel] !== h) problems.push(`被改动: ${rel}`);
  }
  for (const rel of Object.keys(actual)) {
    if (inScope(rel) && !(rel in expected)) problems.push(`新增: ${rel}`);
  }
  return problems;
}
