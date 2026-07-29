import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { sha256Bytes } from "./hash.mjs";

export const REQUIRED_NARRATIVE_ROLES = Object.freeze([
  "cover",
  "problem",
  "mainline",
  "system",
  "core_pages",
  "value",
  "boundaries",
  "next_steps",
]);

const COUNT_KEYS = Object.freeze(["text", "shape", "table", "chart", "image"]);
const NON_VISUAL_KEYS = Object.freeze({
  picture: "p:nvPicPr",
  graphic: "p:nvGraphicFramePr",
  connector: "p:nvCxnSpPr",
  group: "p:nvGrpSpPr",
  shape: "p:nvSpPr",
});
const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  trimValues: false,
});

function array(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValues(value, out = []) {
  if (value === undefined || value === null) return out;
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (key === "a:t") {
      for (const text of array(child)) {
        if (typeof text === "string" || typeof text === "number") out.push(String(text));
        else if (text && typeof text === "object" && typeof text["#text"] === "string") out.push(text["#text"]);
      }
    } else if (child && typeof child === "object") {
      textValues(child, out);
    }
  }
  return out;
}

function textBody(body) {
  const paragraphs = array(body?.["a:p"]);
  if (paragraphs.length) return paragraphs.map((paragraph) => textValues(paragraph).join("")).join("\n");
  return textValues(body).join("");
}

function relationshipPath(partPath) {
  return posix.join(posix.dirname(partPath), "_rels", `${posix.basename(partPath)}.rels`);
}

function resolveTarget(partPath, target) {
  const raw = String(target ?? "");
  const joined = raw.startsWith("/") ? raw : posix.join(posix.dirname(partPath), raw);
  return posix.normalize(joined).replace(/^\/+/, "");
}

async function parsePart(zip, path, { optional = false } = {}) {
  const entry = zip.file(path);
  if (!entry) {
    if (optional) return null;
    throw new Error(`PPTX 缺 OOXML part: ${path}`);
  }
  return XML.parse(await entry.async("string"));
}

function relationships(document) {
  return array(document?.Relationships?.Relationship);
}

const RELATIONSHIP_ID = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const NUMERIC_ID = /^[0-9]+$/;

function validRelationshipId(value) {
  return typeof value === "string" && RELATIONSHIP_ID.test(value);
}

function validNumericId(value, { min = 0, max = 0xffffffff } = {}) {
  if (typeof value !== "string" || !NUMERIC_ID.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max;
}

function relationById(document, id) {
  return relationships(document).find((relation) => relation?.["@Id"] === id) ?? null;
}

function relationByType(document, typeSuffix) {
  return relationships(document).find((relation) => relation?.["@Type"]?.endsWith(typeSuffix)) ?? null;
}

function requiredRelationship(document, { id = null, typeSuffix, label }) {
  const relation = id === null ? relationByType(document, typeSuffix) : relationById(document, id);
  if (!relation) throw new Error(`${label} 缺 relationship`);
  if (!validRelationshipId(relation["@Id"])) throw new Error(`${label} relationship ID 非法`);
  if (!relation["@Type"]?.endsWith(typeSuffix)) throw new Error(`${label} relationship Type 非法`);
  if (typeof relation["@Target"] !== "string" || !relation["@Target"].trim()) throw new Error(`${label} relationship Target 为空`);
  if (relation["@TargetMode"] === "External") throw new Error(`${label} 必须使用 package 内嵌 target`);
  return relation;
}

function requiredTarget(zip, partPath, relation, { prefix, label }) {
  const target = resolveTarget(partPath, relation["@Target"]);
  if (target.startsWith("../") || (prefix && !target.startsWith(prefix))) throw new Error(`${label} relationship target 路径非法`);
  if (!zip.file(target)) throw new Error(`${label} relationship target part 不存在: ${target}`);
  return target;
}

function validateDeclaredRelationships(zip, partPath, document, label) {
  const seenIds = new Set();
  for (const relation of relationships(document)) {
    const id = relation?.["@Id"];
    const type = relation?.["@Type"];
    const targetValue = relation?.["@Target"];
    if (!validRelationshipId(id)) throw new Error(`${label} relationship ID 非法`);
    if (seenIds.has(id)) throw new Error(`${label} relationship ID 重复: ${id}`);
    seenIds.add(id);
    if (typeof type !== "string" || !type.trim()) throw new Error(`${label} relationship ${id} Type 非法`);
    if (typeof targetValue !== "string" || !targetValue.trim()) {
      throw new Error(`${label} relationship ${id} Target 为空`);
    }
    if (relation["@TargetMode"] === "External") {
      if (!type.endsWith("/hyperlink")) throw new Error(`${label} relationship ${id} 必须指向 package 内嵌 target`);
      continue;
    }
    const target = resolveTarget(partPath, targetValue);
    if (!target || target.startsWith("../")) throw new Error(`${label} relationship ${id} target 路径非法`);
    if (!zip.file(target)) throw new Error(`${label} relationship ${id} target part 不存在: ${target}`);
  }
}

function numberAttribute(node, name) {
  const value = Number(node?.[`@${name}`]);
  return Number.isFinite(value) ? value : null;
}

function boundsFromTransform(transform) {
  const offset = transform?.["a:off"];
  const extent = transform?.["a:ext"];
  const x = numberAttribute(offset, "x");
  const y = numberAttribute(offset, "y");
  const width = numberAttribute(extent, "cx");
  const height = numberAttribute(extent, "cy");
  return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
}

function placeholderOf(shape) {
  return shape?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"] ?? null;
}

function placeholderKey(placeholder) {
  if (!placeholder) return null;
  const index = placeholder["@idx"];
  return index !== undefined ? `idx:${index}` : `type:${placeholder["@type"] ?? "body"}`;
}

function shapeIdentity(shape, kind) {
  const property = shape?.[NON_VISUAL_KEYS[kind] ?? NON_VISUAL_KEYS.shape]?.["p:cNvPr"];
  return {
    id: property?.["@id"] === undefined ? null : String(property["@id"]),
    name: property?.["@name"] === undefined ? "" : String(property["@name"]),
  };
}

function graphicType(frame) {
  const data = frame?.["a:graphic"]?.["a:graphicData"];
  if (data?.["a:tbl"] !== undefined) return "table";
  if (data?.["c:chart"] !== undefined || data?.["cx:chart"] !== undefined) return "chart";
  return "shape";
}

function walkDrawables(tree, visit) {
  for (const picture of array(tree?.["p:pic"])) visit("image", picture);
  for (const frame of array(tree?.["p:graphicFrame"])) visit(graphicType(frame), frame);
  for (const group of array(tree?.["p:grpSp"])) walkDrawables(group, visit);
}

function validateEmbeddedTargets(zip, slidePath, document, slideRels, slideNumber) {
  const tree = document?.["p:sld"]?.["p:cSld"]?.["p:spTree"] ?? {};
  walkDrawables(tree, (type, node) => {
    if (type === "image") {
      const relationshipId = node?.["p:blipFill"]?.["a:blip"]?.["@r:embed"];
      if (typeof relationshipId !== "string" || !relationshipId.trim()) {
        throw new Error(`slide ${slideNumber} image 缺 a:blip r:embed`);
      }
      const relation = requiredRelationship(slideRels, {
        id: relationshipId,
        typeSuffix: "/image",
        label: `slide ${slideNumber} image`,
      });
      requiredTarget(zip, slidePath, relation, { prefix: "ppt/media/", label: `slide ${slideNumber} image` });
    }
    if (type === "chart") {
      const chart = node?.["a:graphic"]?.["a:graphicData"]?.["c:chart"]
        ?? node?.["a:graphic"]?.["a:graphicData"]?.["cx:chart"];
      for (const reference of array(chart)) {
        const relationshipId = reference?.["@r:id"];
        if (typeof relationshipId !== "string" || !relationshipId.trim()) {
          throw new Error(`slide ${slideNumber} chart 缺 r:id`);
        }
        const relation = requiredRelationship(slideRels, {
          id: relationshipId,
          typeSuffix: "/chart",
          label: `slide ${slideNumber} chart`,
        });
        requiredTarget(zip, slidePath, relation, { prefix: "ppt/charts/", label: `slide ${slideNumber} chart` });
      }
    }
  });
}

function layoutPlaceholderBounds(document) {
  const shapes = array(document?.["p:sldLayout"]?.["p:cSld"]?.["p:spTree"]?.["p:sp"]);
  const result = new Map();
  for (const shape of shapes) {
    const key = placeholderKey(placeholderOf(shape));
    const bounds = boundsFromTransform(shape?.["p:spPr"]?.["a:xfrm"]);
    if (key && bounds) result.set(key, bounds);
  }
  return result;
}

const IDENTITY_TRANSFORM = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

function multiplyTransform(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

function transformPoint(transform, x, y) {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

function transformBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function centerEffectTransform(transform, bounds) {
  const rotation = numberAttribute(transform, "rot") ?? 0;
  const radians = rotation / 60000 * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const flipX = transformBoolean(transform?.["@flipH"]) ? -1 : 1;
  const flipY = transformBoolean(transform?.["@flipV"]) ? -1 : 1;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const linear = {
    a: cos * flipX,
    b: sin * flipX,
    c: -sin * flipY,
    d: cos * flipY,
    e: 0,
    f: 0,
  };
  return {
    ...linear,
    e: centerX - linear.a * centerX - linear.c * centerY,
    f: centerY - linear.b * centerX - linear.d * centerY,
  };
}

function transformedBounds(transform, parent) {
  const bounds = boundsFromTransform(transform);
  if (!bounds || !parent) return null;
  const composed = multiplyTransform(parent, centerEffectTransform(transform, bounds));
  const points = [
    transformPoint(composed, bounds.x, bounds.y),
    transformPoint(composed, bounds.x + bounds.width, bounds.y),
    transformPoint(composed, bounds.x, bounds.y + bounds.height),
    transformPoint(composed, bounds.x + bounds.width, bounds.y + bounds.height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const clean = (value) => Math.abs(value - Math.round(value)) < 1e-7 ? Math.round(value) : value;
  return { x: clean(minX), y: clean(minY), width: clean(maxX - minX), height: clean(maxY - minY) };
}

function childTransform(parent, transform) {
  if (!parent) return null;
  const bounds = boundsFromTransform(transform);
  const childOffset = transform?.["a:chOff"];
  const childExtent = transform?.["a:chExt"];
  const childX = numberAttribute(childOffset, "x");
  const childY = numberAttribute(childOffset, "y");
  const childWidth = numberAttribute(childExtent, "cx");
  const childHeight = numberAttribute(childExtent, "cy");
  if (!bounds || ![childX, childY, childWidth, childHeight].every(Number.isFinite)
    || childWidth === 0 || childHeight === 0) return null;
  const scaleX = bounds.width / childWidth;
  const scaleY = bounds.height / childHeight;
  const childToBounds = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: bounds.x - childX * scaleX,
    f: bounds.y - childY * scaleY,
  };
  const local = multiplyTransform(centerEffectTransform(transform, bounds), childToBounds);
  return multiplyTransform(parent, local);
}

function appendTreeObjects(tree, layoutBounds, slideSize, transform, objects, nonVisualObjectIds) {

  for (const shape of array(tree["p:sp"])) {
    const identity = shapeIdentity(shape, "shape");
    nonVisualObjectIds.push(identity.id);
    const placeholder = placeholderOf(shape);
    const body = shape?.["p:txBody"];
    const text = body ? textBody(body) : "";
    const ownTransform = shape?.["p:spPr"]?.["a:xfrm"];
    const bounds = ownTransform
      ? transformedBounds(ownTransform, transform)
      : layoutBounds.get(placeholderKey(placeholder)) ?? null;
    objects.push({
      ...identity,
      type: body ? "text" : "shape",
      text,
      placeholderType: placeholder?.["@type"] ?? null,
      placeholderIndex: placeholder?.["@idx"] === undefined ? null : String(placeholder["@idx"]),
      bounds,
      imageCoverage: 0,
    });
  }

  for (const picture of array(tree["p:pic"])) {
    const identity = shapeIdentity(picture, "picture");
    nonVisualObjectIds.push(identity.id);
    const bounds = transformedBounds(picture?.["p:spPr"]?.["a:xfrm"], transform);
    const area = bounds && slideSize.width > 0 && slideSize.height > 0
      ? Math.max(0, Math.min(bounds.x + bounds.width, slideSize.width) - Math.max(bounds.x, 0))
        * Math.max(0, Math.min(bounds.y + bounds.height, slideSize.height) - Math.max(bounds.y, 0))
      : 0;
    objects.push({
      ...identity,
      type: "image",
      text: "",
      placeholderType: null,
      placeholderIndex: null,
      bounds,
      imageCoverage: area / (slideSize.width * slideSize.height),
    });
  }

  for (const frame of array(tree["p:graphicFrame"])) {
    const identity = shapeIdentity(frame, "graphic");
    nonVisualObjectIds.push(identity.id);
    objects.push({
      ...identity,
      type: graphicType(frame),
      text: textValues(frame).join("\n"),
      placeholderType: null,
      placeholderIndex: null,
      bounds: transformedBounds(frame?.["p:xfrm"], transform),
      imageCoverage: 0,
    });
  }

  for (const connector of array(tree["p:cxnSp"])) {
    const identity = shapeIdentity(connector, "connector");
    nonVisualObjectIds.push(identity.id);
    objects.push({
      ...identity,
      type: "shape",
      text: "",
      placeholderType: null,
      placeholderIndex: null,
      bounds: transformedBounds(connector?.["p:spPr"]?.["a:xfrm"], transform),
      imageCoverage: 0,
    });
  }

  for (const group of array(tree["p:grpSp"])) {
    nonVisualObjectIds.push(shapeIdentity(group, "group").id);
    const nestedTransform = childTransform(transform, group?.["p:grpSpPr"]?.["a:xfrm"]);
    appendTreeObjects(group, layoutBounds, slideSize, nestedTransform, objects, nonVisualObjectIds);
  }
}

function slideObjects(document, layoutBounds, slideSize) {
  const tree = document?.["p:sld"]?.["p:cSld"]?.["p:spTree"] ?? {};
  const objects = [];
  const nonVisualObjectIds = [shapeIdentity(tree, "group").id];
  appendTreeObjects(tree, layoutBounds, slideSize, IDENTITY_TRANSFORM, objects, nonVisualObjectIds);

  return { objects, nonVisualObjectIds };
}

function editableCounts(objects) {
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
  for (const object of objects) {
    if (COUNT_KEYS.includes(object.type)) counts[object.type] += 1;
  }
  return counts;
}

function notesText(document) {
  const shapes = array(document?.["p:notes"]?.["p:cSld"]?.["p:spTree"]?.["p:sp"]);
  return shapes
    .filter((shape) => placeholderOf(shape)?.["@type"] === "body")
    .map((shape) => textBody(shape?.["p:txBody"]))
    .filter(Boolean)
    .join("\n");
}

function notesSourcesBlock(notes) {
  const lines = String(notes ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[Sources]");
  if (start < 0) return null;
  const following = lines.slice(start + 1);
  const end = following.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  return (end < 0 ? following : following.slice(0, end)).join("\n");
}

export async function inspectPptx(path) {
  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const presentationPath = "ppt/presentation.xml";
  const presentation = await parsePart(zip, presentationPath);
  const presentationRels = await parsePart(zip, relationshipPath(presentationPath));
  validateDeclaredRelationships(zip, presentationPath, presentationRels, "presentation");
  const root = presentation?.["p:presentation"];
  const slideSize = {
    width: numberAttribute(root?.["p:sldSz"], "cx"),
    height: numberAttribute(root?.["p:sldSz"], "cy"),
  };
  if (![slideSize.width, slideSize.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("PPTX presentation.xml 缺合法 slide size");
  }

  const slideIds = array(root?.["p:sldIdLst"]?.["p:sldId"]);
  const slides = [];
  for (const [index, slideId] of slideIds.entries()) {
    const stableId = String(slideId?.["@id"] ?? "");
    if (!validNumericId(stableId, { min: 256, max: 0x7fffffff })) {
      throw new Error(`PPTX slide ${index + 1} stable slide ID 非法`);
    }
    const relationshipId = slideId?.["@r:id"];
    const relation = requiredRelationship(presentationRels, {
      id: relationshipId,
      typeSuffix: "/slide",
      label: `PPTX slide ${index + 1}`,
    });
    const slidePath = requiredTarget(zip, presentationPath, relation, {
      prefix: "ppt/slides/",
      label: `PPTX slide ${index + 1}`,
    });
    const slide = await parsePart(zip, slidePath);
    const slideRelsPath = relationshipPath(slidePath);
    const slideRels = await parsePart(zip, slideRelsPath);
    validateDeclaredRelationships(zip, slidePath, slideRels, `slide ${index + 1}`);

    const layoutRelation = requiredRelationship(slideRels, {
      typeSuffix: "/slideLayout",
      label: `slide ${index + 1} layout`,
    });
    const layoutPath = requiredTarget(zip, slidePath, layoutRelation, {
      prefix: "ppt/slideLayouts/",
      label: `slide ${index + 1} layout`,
    });
    const layout = await parsePart(zip, layoutPath);
    const layoutBounds = layoutPlaceholderBounds(layout);

    const notesRelation = requiredRelationship(slideRels, {
      typeSuffix: "/notesSlide",
      label: `slide ${index + 1} notes`,
    });
    const notesPath = requiredTarget(zip, slidePath, notesRelation, {
      prefix: "ppt/notesSlides/",
      label: `slide ${index + 1} notes`,
    });
    const notesDocument = await parsePart(zip, notesPath);
    const notesRels = await parsePart(zip, relationshipPath(notesPath));
    validateDeclaredRelationships(zip, notesPath, notesRels, `slide ${index + 1} notes`);
    const backlink = requiredRelationship(notesRels, {
      typeSuffix: "/slide",
      label: `slide ${index + 1} notes backlink`,
    });
    if (resolveTarget(notesPath, backlink["@Target"]) !== slidePath) {
      throw new Error(`slide ${index + 1} notes backlink 指向错误 slide`);
    }
    const notes = notesText(notesDocument);
    validateEmbeddedTargets(zip, slidePath, slide, slideRels, index + 1);
    const { objects, nonVisualObjectIds } = slideObjects(slide, layoutBounds, slideSize);
    slides.push({
      number: index + 1,
      stableId,
      relationshipId: String(relationshipId ?? ""),
      slidePath,
      layoutPath,
      notesPath,
      notes,
      editableObjectCounts: editableCounts(objects),
      imageCoverage: Math.max(0, ...objects.filter((object) => object.type === "image").map((object) => object.imageCoverage)),
      emptyPlaceholderIds: objects
        .filter((object) => object.placeholderType && !object.text.trim())
        .map((object) => object.id),
      nonVisualObjectIds,
      objects,
    });
  }

  return {
    pptxSha256: sha256Bytes(bytes),
    slideSize,
    slides,
  };
}

function sameCounts(left, right) {
  return COUNT_KEYS.every((key) => Number(left?.[key]) === Number(right?.[key]));
}

function objectPairKey(left, right) {
  return [String(left), String(right)].sort().join("\u0000");
}

function boundsOverlap(left, right) {
  if (!left || !right) return false;
  return left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height;
}

function actualOverlaps(objects) {
  const identified = new Map();
  const unidentified = [];
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const left = objects[leftIndex];
      const right = objects[rightIndex];
      if (!boundsOverlap(left.bounds, right.bounds)) continue;
      if (left.id && right.id) {
        identified.set(objectPairKey(left.id, right.id), [left.id, right.id]);
      } else {
        unidentified.push([left.id, right.id]);
      }
    }
  }
  return { identified, unidentified };
}

function manifestSourceIssues(entry, slide, expected) {
  const issues = [];
  const block = notesSourcesBlock(slide.notes);
  if (!Array.isArray(entry?.project_sources)) {
    issues.push(`slide ${slide.number} project_sources 必须为数组`);
  } else {
    if (!entry.project_sources.includes("Design.md")) issues.push(`slide ${slide.number} project_sources 缺 Design.md`);
    const prototypeSource = `prototype/index.html@v${expected.prototypeVersion}`;
    if (!entry.project_sources.includes(prototypeSource)) issues.push(`slide ${slide.number} project_sources 缺 ${prototypeSource}`);
    for (const source of entry.project_sources) {
      if (typeof source !== "string" || !source.trim()) issues.push(`slide ${slide.number} project_sources 含空来源`);
    }
  }
  if (!Array.isArray(entry?.external_sources)) {
    issues.push(`slide ${slide.number} external_sources 必须为数组`);
  } else {
    for (const source of entry.external_sources) {
      if (typeof source !== "string" || !source.trim()) issues.push(`slide ${slide.number} external_sources 含空来源`);
      else if (!block?.includes(source)) issues.push(`slide ${slide.number} [Sources] 来源块缺 external source: ${source}`);
    }
  }
  if (block === null) issues.push(`slide ${slide.number} notes 缺 [Sources]`);
  if (!block?.includes(`Design.md@${expected.designDocumentSha256}`)) {
    issues.push(`slide ${slide.number} [Sources] 来源块缺当前 Design.md SHA`);
  }
  if (!block?.includes(`prototype/index.html@v${expected.prototypeVersion}`)) {
    issues.push(`slide ${slide.number} [Sources] 来源块缺当前 prototype version`);
  }
  return issues;
}

function boundsIssues(slide, slideSize) {
  const issues = [];
  for (const object of slide.objects) {
    const bounds = object.bounds;
    if (!bounds || !Object.values(bounds).every(Number.isFinite)) {
      issues.push(`slide ${slide.number} object ${object.id ?? "unknown"} 缺 bounds`);
      continue;
    }
    if (bounds.width <= 0 || bounds.height <= 0) {
      issues.push(`slide ${slide.number} object ${object.id ?? "unknown"} bounds 尺寸非法`);
      continue;
    }
    if (bounds.x < 0 || bounds.y < 0
      || bounds.x + bounds.width > slideSize.width
      || bounds.y + bounds.height > slideSize.height) {
      issues.push(`slide ${slide.number} object ${object.id ?? "unknown"} 越出 slide canvas`);
    }
  }
  return issues;
}

function overlapIssues(slide, entry) {
  const issues = [];
  const objectsById = new Map(slide.objects.map((object) => [object.id, object]));
  const overlaps = actualOverlaps(slide.objects);
  const allowed = new Set();
  const declarations = entry?.allowed_overlaps;
  if (!Array.isArray(declarations)) {
    issues.push(`slide ${slide.number} allowed_overlaps 必须为数组`);
  } else {
    for (const declaration of declarations) {
      const ids = declaration?.object_ids;
      if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => typeof id !== "string" || !id)
        || ids[0] === ids[1]) {
        issues.push(`slide ${slide.number} allowed_overlaps 必须使用两个不同 object id`);
        continue;
      }
      if (typeof declaration.reason !== "string" || !declaration.reason.trim()) {
        issues.push(`slide ${slide.number} allowed_overlaps ${ids.join("/")} 缺非空 reason`);
      }
      const key = objectPairKey(ids[0], ids[1]);
      if (allowed.has(key)) issues.push(`slide ${slide.number} allowed_overlaps 重复对象对 ${ids.join("/")}`);
      allowed.add(key);
      const unknown = ids.filter((id) => !objectsById.has(id));
      if (unknown.length) issues.push(`slide ${slide.number} allowed_overlaps 含未知 object: ${unknown.join(", ")}`);
      else if (!overlaps.identified.has(key)) issues.push(`slide ${slide.number} allowed_overlaps 对象对并未重叠: ${ids.join("/")}`);
    }
  }
  for (const [key, ids] of overlaps.identified) {
    if (!allowed.has(key)) issues.push(`slide ${slide.number} object overlap 未声明: ${ids.join("/")}`);
  }
  for (const ids of overlaps.unidentified) {
    issues.push(`slide ${slide.number} object overlap 含缺失 ID，无法声明精确对象对: ${ids.map((id) => id ?? "missing").join("/")}`);
  }
  return issues;
}

function fullBleedIssues(slide, entry, titleObject) {
  const issues = [];
  const images = slide.objects.filter((object) => object.type === "image" && object.imageCoverage >= 0.9);
  const declaration = entry?.full_bleed_background;
  if (!images.length) {
    // 契约要求无 full-bleed 背景的 slide 显式声明 null；缺键与"声明了却没有对应图片"
    // 是两种错误，混用同一条消息会把生成器引向错误的修复方向。
    if (declaration === undefined) issues.push(`slide ${slide.number} manifest entry 缺 full_bleed_background 键（无 full-bleed 背景须显式为 null）`);
    else if (declaration !== null) issues.push(`slide ${slide.number} full_bleed_background 无对应 >=90% 图片`);
    return issues;
  }
  if (images.length > 1) {
    issues.push(`slide ${slide.number} 含多张 >=90% full-bleed image，singular full_bleed_background 不能授权多个对象`);
  }
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    issues.push(`slide ${slide.number} >=90% full-bleed image 未声明背景用途`);
    return issues;
  }
  if (typeof declaration.reason !== "string" || !declaration.reason.trim()) {
    issues.push(`slide ${slide.number} full_bleed_background 缺非空 reason`);
  }
  if (!images.some((image) => image.id === declaration.object_id)) {
    issues.push(`slide ${slide.number} full_bleed_background.object_id 不是 >=90% 图片`);
  }
  if (!titleObject?.text?.trim()) issues.push(`slide ${slide.number} full-bleed 背景必须保留 editable title`);
  return issues;
}

export function presentationStructureIssues(inspected, manifest, expected) {
  const issues = [];
  if (!inspected || typeof inspected !== "object" || !Array.isArray(inspected.slides)) {
    return ["PPTX inspection 结果非法"];
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["presentation manifest 必须为对象"];
  if (!expected || typeof expected !== "object") return ["presentation expected bindings 缺失"];

  if (manifest.path !== "presentation/design-system.pptx") issues.push("manifest.path 必须为 presentation/design-system.pptx");
  if (manifest.pptx_sha256 !== inspected.pptxSha256) issues.push("manifest.pptx_sha256 与重算 PPTX SHA 不符");
  if (manifest.design_document_sha256 !== expected.designDocumentSha256) {
    issues.push("manifest.design_document_sha256 与当前 Design.md 不符");
  }
  if (manifest.artifact_version !== expected.prototypeVersion) {
    issues.push("manifest.artifact_version 与当前 prototype version 不符");
  }
  if (!Number.isInteger(manifest.artifact_revision) || manifest.artifact_revision < 1) {
    issues.push("manifest.artifact_revision 必须为正整数");
  }
  if (manifest.source_bundle_digest !== expected.sourceBundleDigest) {
    issues.push("manifest.source_bundle_digest 与冻结交付来源不符");
  }

  const entries = Array.isArray(manifest.slides) ? manifest.slides : [];
  if (!Array.isArray(manifest.slides)) issues.push("manifest.slides 必须为数组");
  if (entries.length !== inspected.slides.length) issues.push("manifest slide 数量与 PPTX 不符");
  const roles = entries.map((entry) => entry?.narrative_role);
  if (JSON.stringify(roles) !== JSON.stringify(REQUIRED_NARRATIVE_ROLES)) {
    issues.push(`narrative role 必须按固定顺序覆盖: ${REQUIRED_NARRATIVE_ROLES.join(", ")}`);
  }

  const seenSlideIds = new Set();
  const seenRelationships = new Set();
  for (const [index, slide] of inspected.slides.entries()) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(`slide ${slide.number} 缺 manifest entry`);
      continue;
    }
    if (entry.slide_number !== slide.number) issues.push(`slide ${slide.number} manifest slide_number 不符`);
    if (entry.slide_id !== slide.stableId) issues.push(`slide ${slide.number} stable slide_id 不符`);
    if (entry.relationship_id !== slide.relationshipId) issues.push(`slide ${slide.number} relationship_id 不符`);
    if (typeof slide.stableId !== "string" || !slide.stableId.trim()) issues.push(`slide ${slide.number} 缺 stable slide ID`);
    if (typeof slide.relationshipId !== "string" || !slide.relationshipId.trim()) {
      issues.push(`slide ${slide.number} 缺 relationship_id`);
    }
    if (seenSlideIds.has(slide.stableId)) issues.push(`重复 stable slide_id: ${slide.stableId}`);
    if (seenRelationships.has(slide.relationshipId)) issues.push(`重复 relationship_id: ${slide.relationshipId}`);
    seenSlideIds.add(slide.stableId);
    seenRelationships.add(slide.relationshipId);
    if (!sameCounts(entry.object_counts, slide.editableObjectCounts)) {
      issues.push(`slide ${slide.number} object_counts 与 OOXML 重算对象数量不符`);
    }

    const objectIds = slide.nonVisualObjectIds ?? slide.objects.map((object) => object.id);
    if (objectIds.some((id) => !validNumericId(id))) issues.push(`slide ${slide.number} editable object OOXML ID 缺失或非法`);
    if (new Set(objectIds).size !== objectIds.length) issues.push(`slide ${slide.number} 含重复 object id`);
    const titleObject = slide.objects.find((object) => object.id === entry.title_object_id);
    if (!titleObject || titleObject.type !== "text" || !titleObject.text.trim()) {
      issues.push(`slide ${slide.number} 缺 manifest 指定的 editable title`);
    }
    if (entry.narrative_role !== "cover") {
      const bodyObjects = slide.objects.filter((object) =>
        object.type === "text" && object.id !== entry.title_object_id && object.text.trim());
      if (slide.editableObjectCounts.text < 2 || bodyObjects.length === 0) {
        issues.push(`slide ${slide.number} content slide 至少需要 editable title 和 body`);
      }
    }
    for (const placeholderId of slide.emptyPlaceholderIds ?? []) {
      issues.push(`slide ${slide.number} 含 empty placeholder: ${placeholderId}`);
    }
    issues.push(...manifestSourceIssues(entry, slide, expected));
    issues.push(...boundsIssues(slide, inspected.slideSize));
    issues.push(...fullBleedIssues(slide, entry, titleObject));
    issues.push(...overlapIssues(slide, entry));
  }
  return [...new Set(issues)];
}
