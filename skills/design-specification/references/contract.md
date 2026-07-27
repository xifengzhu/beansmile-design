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
