# Codex presentation adapter

Use the available Presentations capability and `@oai/artifact-tool` adapter for production generation. The adapter must prove all of these capabilities with actual files and object inspection:

1. Create a blank presentation and export `.pptx`.
2. Add editable text, shapes, tables, images, and speaker notes.
3. Reopen the exported deck and inspect slide/object structure.
4. Render every slide to PNG.
5. Produce layout evidence for overlap, overflow, clipping, bounds, and font checks.

Do not infer capability from an installed command or library. The environment probe must create a minimal deck containing editable text, reopen it, verify its object type, and render a nonblank slide.

The adapter is an implementation boundary, not permission to change the output contract. Do not use PptxGenJS or python-pptx for a production deck; they are allowed only in deterministic repository tests/probes where explicitly named. Do not convert a PDF or slide-sized images into PPTX.

If create/export/reopen fails, stop with `blocked`. If the editable deck is created but rendering or layout evidence is unavailable, return `unverified` and exit code `3`; do not return an artifact patch or claim completion.

Run `npm run presentation:probe` before production generation. The repository probe uses PptxGenJS only to create its deterministic disposable editable fixture, rereads that fixture through the OOXML inspector, and renders it through LibreOffice (`soffice`) plus Poppler (`pdftoppm`). Exit code `3` means the rendering capability is unavailable and the presentation remains unverified; it is never a pass.
