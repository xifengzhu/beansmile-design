#!/usr/bin/env node
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import PptxGenJS from "pptxgenjs";
import { inspectPptx } from "./lib/presentation.mjs";
import { renderPptx, resolvePresentationTools } from "./lib/presentation-render.mjs";

export async function probePresentation(options = {}) {
  const tools = options.tools ?? resolvePresentationTools(options);
  const result = {
    available: false,
    tools_available: tools.available,
    generation: false,
    reread: false,
    rendering: false,
    error: tools.error,
  };
  if (!tools.available) return result;

  const root = mkdtempSync(join(options.tmpRoot ?? tmpdir(), "beansmile-presentation-probe-"));
  try {
    const pptxPath = join(root, "editable-probe.pptx");
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "beansmile-design presentation probe";
    const slide = pptx.addSlide();
    slide.addText("Editable probe title", { x: 0.8, y: 0.7, w: 8.5, h: 0.6, fontSize: 30 });
    slide.addText("Editable probe body", { x: 0.8, y: 1.6, w: 8.5, h: 0.8, fontSize: 18 });
    slide.addShape(pptx.ShapeType.rect, { x: 10.3, y: 1.4, w: 1.5, h: 1.1, fill: { color: "14532D" } });
    slide.addNotes("[Sources]\n- internal: editable presentation environment probe");
    await pptx.writeFile({ fileName: pptxPath, compression: false });
    result.generation = existsSync(pptxPath);
    if (!result.generation) throw new Error("presentation probe 未生成 PPTX");

    const inspected = await inspectPptx(pptxPath);
    const counts = inspected.slides[0]?.editableObjectCounts;
    result.reread = inspected.slides.length === 1 && counts?.text === 2 && counts?.shape === 1;
    if (!result.reread) throw new Error("presentation probe 未能重读 editable text/shape objects");

    const rendered = await renderPptx(pptxPath, join(root, "rendered"), tools);
    result.rendering = rendered.renders.length === 1
      && existsSync(rendered.renders[0].path);
    if (!result.rendering) throw new Error("presentation probe 未生成唯一非空 PNG render");
    result.available = true;
    result.error = null;
    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 必须用 pathToFileURL：import.meta.url 是百分号编码的，裸拼接在含空格/非 ASCII 的
// 仓库路径下永不相等——能力探测会静默跳过并 exit 0（假成功）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probePresentation();
  if (result.available) {
    console.log("✓ presentation probe: generation, OOXML reread, and rendering available");
    process.exit(0);
  }
  const status = result.tools_available ? 1 : 3;
  const label = status === 3 ? "unavailable / 未验证" : "failed";
  console.error(`✗ presentation probe ${label}: ${result.error}`);
  process.exit(status);
}
