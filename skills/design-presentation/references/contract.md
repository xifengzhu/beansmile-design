# Presentation contract

## Fixed outputs

```text
presentation/design-system.pptx
audit/presentation/manifest.json
audit/presentation/qa.json
audit/presentation/rendered/<slide>.png
```

The rendered directory is evidence, not a separate static deliverable. Do not add a PDF, alternate deck, or custom output root.

## Narrative roles

Cover these role IDs exactly once and in this order. The structure manifest uses the IDs, not translated display labels:

1. `cover`: project name, proposal, and version.
2. `problem`: current problem, business goal, and design goal.
3. `mainline`: design throughline and problem-to-solution mapping.
4. `system`: color, type, spacing, components, icons, imagery, and motion.
5. `core_pages`: core pages and key flows.
6. `value`: design value supported only by verified project evidence.
7. `boundaries`: known boundaries, remaining work, implementation risks, and manual checks.
8. `next_steps`: concrete next steps for development and product teams.

Each slide has one primary narrative job and a conclusion-led title. Avoid production labels such as `页面展示` or `设计说明`. Speaker notes use a `[Sources]` block for external facts and images; internal sources include package-relative paths and snapshot versions.

Every slide note must contain the current `Design.md@<sha256>` and `prototype/index.html@v<artifact_version>` references inside the `[Sources]` block. Every nonempty `external_sources` entry in the manifest must also appear verbatim inside that block; text before the marker or under a later notes heading does not satisfy source binding. The manifest must list `project_sources` and `external_sources` separately; an empty external list is valid, an omitted list is not.

## Editability

- Keep titles, body copy, page numbers, fills, tables, basic shapes, and simple relationships as native editable PowerPoint objects.
- Raster images are allowed for prototype screenshots, photographs, brand imagery, and complex illustration.
- Cover and section slides may use full-bleed images, but titles remain editable text.
- Content slides cannot consist of one full-slide image. Design-system slides must expose swatches, type labels, and component annotation as separate objects.
- Every slide identifies a nonempty editable title through `title_object_id`. Every role except `cover` has at least one additional nonempty editable text object.
- Empty text placeholders and objects outside the slide canvas fail structural validation.
- An image covering at least 90% of the canvas is a full-bleed image. Only one >=90% image is allowed on a slide. It requires `full_bleed_background.object_id`, a nonempty `reason`, and a retained editable title; otherwise it fails.

## Bounds and overlap

The inspector recomputes every object's nonempty stable OOXML ID and `{x,y,width,height}` bounds. Slide and drawing-object IDs must be numeric in their OOXML ranges; relationship IDs must be valid XML IDs. Root group, nested group, and leaf object IDs must all be present and unique within each slide. Grouped objects are inspected recursively; group and child scale, translation, rotation, and horizontal/vertical flip transforms are composed into absolute axis-aligned slide bounds before counts, overflow, image coverage, and overlap checks run. Any intersecting object pair fails unless that exact pair is declared for the slide:

```json
{
  "allowed_overlaps": [
    {
      "object_ids": ["2", "5"],
      "reason": "Editable title intentionally overlays the declared background image"
    }
  ]
}
```

`object_ids` contains exactly two different IDs from the same slide. Wildcards, unknown IDs, duplicate declarations, declarations for non-overlapping objects, and empty reasons are invalid.

## Evidence

`manifest.json` records the presentation and source bindings plus exact per-slide structure:

```json
{
  "path": "presentation/design-system.pptx",
  "pptx_sha256": "<sha256>",
  "artifact_version": "<current prototype artifact_version>",
  "artifact_revision": 1,
  "source_manifest_digest": "<sha256>",
  "source_bundle_digest": "<sha256>",
  "design_document_sha256": "<sha256>",
  "slides": [
    {
      "slide_number": 1,
      "slide_id": "256",
      "relationship_id": "rId2",
      "narrative_role": "cover",
      "title_object_id": "2",
      "project_sources": ["Design.md", "prototype/index.html@v3"],
      "external_sources": [],
      "object_counts": { "text": 2, "shape": 0, "table": 0, "chart": 0, "image": 0 },
      "full_bleed_background": null,
      "allowed_overlaps": []
    }
  ]
}
```

`artifact_version` is the current prototype version. `artifact_revision` starts at `1`, increments by one when regenerating for the same prototype, and resets to `1` after a new prototype version. Slide IDs, relationships, `object_counts`, bounds, image coverage, and overlaps are OOXML facts and are recomputed instead of trusted.

Every slide requires a valid layout relationship and notes relationship. The notes part requires a notes-to-slide backlink to the same slide. Every embedded picture's image relationship must resolve to an existing media part, and every chart relationship must resolve to an existing chart part. All declared internal presentation, slide, and notes relationships must resolve to existing package parts; valid package-absolute and part-relative targets are both accepted. Only hyperlink relationships may use an external target. Missing or malformed IDs, relationships, backlinks, targets, and target parts fail closed.

`qa.json` binds the PPTX SHA and records per-slide render path/hash, layout/font checks, tool identities, timestamp, status, and manual items. Values are claims until repository validators recompute them.

The Skill never creates `director-review.json`. A Director in another session must view every final render and record that evidence after the deck passes structural and render checks.

Production generation uses the configured presentation adapter. PptxGenJS is allowed only for deterministic repository fixture/probe generation and must never produce the delivered presentation.

## Artifact patch

The only allowed patch shape is:

```yaml
artifacts:
  presentation:
    path: presentation/design-system.pptx
    artifact_version: "<current prototype artifact_version>"
    artifact_revision: <next integer for that prototype version>
    source_manifest_digest: <sha256>
    source_bundle_digest: <sha256>
    design_document_sha256: <sha256>
    sha256: <sha256>
    updated_by: design_presentation
```
