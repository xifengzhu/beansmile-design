export const DELIVERY_OUTPUTS = Object.freeze([
  "design_specification",
  "design_presentation",
]);

export const DELIVERY_PACKAGE_VERSION = 3;

export function requiredDeliveryOutputs(ctx) {
  const requested = new Set(ctx?.project?.delivery_outputs ?? []);
  if (ctx?.project?.mode === "professional") return [...DELIVERY_OUTPUTS];
  if (requested.has("design_presentation")) requested.add("design_specification");
  return DELIVERY_OUTPUTS.filter((id) => requested.has(id));
}

export function deliveryModeIssues(ctx, { enforce = false } = {}) {
  if (!enforce) return [];
  const requested = ctx?.project?.delivery_outputs ?? [];
  const unknown = requested.filter((id) => !DELIVERY_OUTPUTS.includes(id));
  const duplicate = requested.filter((id, index) => requested.indexOf(id) !== index);
  const missing = ctx?.project?.mode === "professional"
    ? DELIVERY_OUTPUTS.filter((id) => !requested.includes(id))
    : [];
  return [
    ...(unknown.length ? [`未知 delivery_outputs: ${unknown.join(", ")}`] : []),
    ...(duplicate.length ? [`重复 delivery_outputs: ${[...new Set(duplicate)].join(", ")}`] : []),
    ...(missing.length ? [`专业模式缺少 delivery_outputs: ${missing.join(", ")}`] : []),
  ];
}

export function requiresDesignContract(ctx) {
  if ((ctx?.project?.package_format_version ?? 0) < DELIVERY_PACKAGE_VERSION) return false;
  return requiredDeliveryOutputs(ctx).includes("design_specification");
}

export function deliveryArtifactVersionIssues(before, next, { kind, prototypeVersion } = {}) {
  if (kind === "design_document") {
    const previousText = before?.artifact_version ?? "0";
    const currentText = next?.artifact_version;
    const previous = /^[0-9]+$/.test(previousText) ? Number(previousText) : Number.NaN;
    const current = /^[1-9][0-9]*$/.test(currentText ?? "") ? Number(currentText) : Number.NaN;
    return Number.isInteger(current) && current === previous + 1
      ? []
      : [`design_document artifact_version 必须从 ${previousText} 递增到 ${Number.isInteger(previous) ? previous + 1 : "有效整数"}`];
  }

  if (kind === "presentation") {
    const expectedRevision = before?.artifact_version === prototypeVersion
      ? Number(before.artifact_revision) + 1
      : 1;
    return next?.artifact_version === prototypeVersion
      && Number.isInteger(next?.artifact_revision)
      && next.artifact_revision === expectedRevision
      ? []
      : [`presentation 必须绑定 prototype ${prototypeVersion} 且 artifact_revision=${expectedRevision}`];
  }

  return [`未知 delivery artifact kind: ${kind}`];
}
