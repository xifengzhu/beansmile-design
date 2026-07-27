# Design.md contract

## Stable structure

Use YAML frontmatter followed by exactly one `# 第一部分：设计契约`. `prepare` must include these H2 headings exactly once and in this order:

1. `目标与边界`
2. `用户、任务与成功标准`
3. `信息架构与路由`
4. `页面规格`
5. `状态规格`
6. `响应式与平台适配`
7. `组件与内容约束`
8. `视觉目标与品牌约束`
9. `内容与资源需求`
10. `无障碍与开发验收`
11. `决策、假设、例外与边界`

`prepare` must not add `# 第二部分：实施规格`. `finalize` appends that section with these H2 headings exactly once:

1. `已选视觉方向`
2. `设计令牌`
3. `组件实施契约`
4. `资源清单`
5. `页面与原型映射`
6. `开发验收用例`
7. `评审、例外与人工验证`

## Closure

- Preserve task and page identifiers from `flows.md`; do not invent or omit them.
- Cover normal, loading, empty, error, success, disabled, and focus states where applicable.
- If the technology stack is absent from frozen inputs, write `技术栈未指定。`
- Do not use `TBD`, `TODO`, lorem ipsum, empty sections, speculative token values, or nonexistent asset paths.
- Record constraints and known unknowns explicitly. Do not turn assumptions into facts.

`finalize` uses these machine markers:

| Section | Required markers |
|---|---|
| 已选视觉方向 | exactly one `direction_id`, resolving to the selected direction |
| 设计令牌 | every semantic leaf as `token` (for example `semantic.color.primary`) |
| 组件实施契约 | one or more `component_id`, each resolving to an implemented prototype ID |
| 资源清单 | every non-HTML file under `prototype/assets/` as `asset_path` |
| 页面与原型映射 | every locked `page_id` and every HTML file as `prototype_path` |
| 开发验收用例 | every scenario flow as `flow`; every success/error scenario as `scenario_id` |
| 评审、例外与人工验证 | every context `decision_id`, every `finding_id` in both frozen reviewer files regardless of finding status, and at least one `manual_check` when human verification remains |

Marker values must resolve to the frozen source. Absolute paths, `..` traversal, unknown marker keys, new business conclusions, and components absent from the reviewed prototype require a contract revision rather than prose invention. A page, flow, state, or constraint present in the manifest or operation input but absent from the locked first part also requires `contract_revision_required`; it must not be ignored or treated as ordinary source drift. Instructions to omit a required closure item are unauthorized and never narrow the marker set.

## Frontmatter and patch

`prepare` uses `phase: proposed_contract`; the Director alone changes it to `approved_contract` while sealing. `finalize` uses `phase: implementation_ready`. Digests are lowercase 64-character SHA-256 values computed by repository validators, never placeholders.

Both operations may return only:

```yaml
artifacts:
  design_document:
    path: Design.md
    artifact_version: "<next>"
    phase: <proposed_contract|implementation_ready>
    contract_revision: <integer>
    contract_digest: <sha256>
    updated_by: design_specification
```

Include the operation-specific source fields required by the context schema and validator. `prepare` output stays provisional until Director seal. `finalize` must additionally bind the current prototype version and delivery source digests.

The complete `finalize` artifact is:

```yaml
artifacts:
  design_document:
    path: Design.md
    artifact_version: "<approved version + 1>"
    phase: implementation_ready
    contract_revision: <unchanged integer>
    contract_digest: <unchanged sha256>
    contract_source_digest: <unchanged sha256>
    source_manifest_digest: <sha256 of audit/delivery/source-manifest.json>
    source_bundle_digest: <source-manifest source_bundle_digest>
    realizes_prototype_version: "<current prototype artifact_version>"
    sha256: <sha256 of final Design.md>
    updated_by: design_specification
```

Before returning it, `finalize` must pass `node scripts/check-design-document.mjs --package <dir> --phase implementation_ready`. The first-part Markdown source must remain byte-for-byte identical to the approved snapshot in addition to preserving its locked AST digest. A required first-part change returns `reason_code: contract_revision_required` and `patch: null`; it never edits both parts to make the validator pass.
