import type { ComponentInput } from "@/lib/domain";
import {
  findNearbyStructuralEvidence,
  type StructuralTextEvidence,
} from "@/lib/cad/structural-evidence";

function nativeEvidenceLine(item: StructuralTextEvidence) {
  return `CAD原生文字 ${item.rawText}（句柄 ${item.handle ?? "无"}，图层 ${item.layer}）`;
}

function selectEvidence(component: ComponentInput, nearby: StructuralTextEvidence[]) {
  const normalizedVisualTag = component.tag?.trim().toUpperCase();
  return nearby.find((item) => item.tag === normalizedVisualTag) ?? nearby[0];
}

export function fuseCadAndVisionComponents(
  visualComponents: ComponentInput[],
  structuralEvidence: StructuralTextEvidence[],
): ComponentInput[] {
  return visualComponents.map((component) => {
    if (!component.location) return component;
    const nearby = findNearbyStructuralEvidence(structuralEvidence, component.location);
    const native = selectEvidence(component, nearby);
    if (!native) return component;

    const visualTag = component.tag?.trim().toUpperCase();
    const tagConflict = Boolean(visualTag && visualTag !== native.tag);
    const categoryConflict = component.category !== "unknown" && component.category !== native.category;
    const conflictEvidence = [
      ...(tagConflict ? [`结构/视觉标签冲突：CAD=${native.tag}，视觉=${visualTag}`] : []),
      ...(categoryConflict ? [`结构/视觉类别冲突：CAD=${native.category}，视觉=${component.category}`] : []),
    ];

    return {
      ...component,
      tag: native.tag,
      category: native.category,
      confidence: Math.max(component.confidence, native.confidence),
      evidence: [...new Set([...component.evidence, nativeEvidenceLine(native), ...conflictEvidence])],
      method: "hybrid_cad_vision",
      reviewStatus: tagConflict || categoryConflict ? "requires_review" : component.reviewStatus,
    };
  });
}
