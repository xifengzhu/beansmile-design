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

Cover all roles using the amount of slides the project needs; page count is not a pass condition:

1. Cover with project name, proposal, and version.
2. Current problem, business goal, and design goal.
3. Design throughline and problem-to-solution mapping.
4. Design system: color, type, spacing, components, icons, imagery, and motion.
5. Core pages and key flows.
6. Design value supported only by verified project evidence.
7. Known boundaries, remaining work, implementation risks, and manual checks.
8. Concrete next steps for development and product teams.

Each slide has one primary narrative job and a conclusion-led title. Avoid production labels such as `页面展示` or `设计说明`. Speaker notes use a `[Sources]` block for external facts and images; internal sources include package-relative paths and snapshot versions.

## Editability

- Keep titles, body copy, page numbers, fills, tables, basic shapes, and simple relationships as native editable PowerPoint objects.
- Raster images are allowed for prototype screenshots, photographs, brand imagery, and complex illustration.
- Cover and section slides may use full-bleed images, but titles remain editable text.
- Content slides cannot consist of one full-slide image. Design-system slides must expose swatches, type labels, and component annotation as separate objects.

## Evidence

`manifest.json` records stable slide ID, slide number, narrative role, sources, recomputable object counts, and any permitted full-bleed background reason. `qa.json` binds the PPTX SHA and records per-slide render path/hash, layout/font checks, tool identities, timestamp, status, and manual items. Values are claims until repository validators recompute them.

The Skill never creates `director-review.json`. A Director in another session must view every final render and record that evidence after the deck passes structural and render checks.

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
