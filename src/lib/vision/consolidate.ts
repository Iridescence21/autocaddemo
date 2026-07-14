import type { CadDrawingTile, RenderedCadDrawing } from "@/lib/cad/types";
import type { ComponentInput } from "@/lib/domain";
import type { ValidatedVisionResult, VisionDetection, VisionLocation } from "@/lib/vision/types";

type LocatedDetection = VisionDetection & { overviewLocation: VisionLocation; sourceTileIds: string[] };

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function toOverview(location: VisionLocation, tile: CadDrawingTile | undefined, rendered: RenderedCadDrawing): VisionLocation {
  if (!tile) return { x: clamp(location.x), y: clamp(location.y), width: clamp(location.width), height: clamp(location.height) };
  return {
    x: clamp((tile.x + location.x * tile.width) / rendered.width),
    y: clamp((tile.y + location.y * tile.height) / rendered.height),
    width: clamp(location.width * tile.width / rendered.width),
    height: clamp(location.height * tile.height / rendered.height),
  };
}

function intersectionOverUnion(left: VisionLocation, right: VisionLocation) {
  const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = intersectionWidth * intersectionHeight;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizedLabel(label: string | null) {
  const normalized = label?.trim().toLowerCase();
  return normalized || null;
}

function compatible(left: LocatedDetection, right: LocatedDetection) {
  const iou = intersectionOverUnion(left.overviewLocation, right.overviewLocation);
  const leftLabel = normalizedLabel(left.label);
  const rightLabel = normalizedLabel(right.label);
  const labelsAgree = leftLabel !== null && leftLabel === rightLabel;
  const categoriesAgree = left.category === right.category || left.category === "unknown" || right.category === "unknown";
  if (!categoriesAgree) return false;
  if (leftLabel && rightLabel && !labelsAgree) return false;
  return iou >= 0.72 || (labelsAgree && iou >= 0.48);
}

function merge(left: LocatedDetection, right: LocatedDetection): LocatedDetection {
  const winner = right.confidence > left.confidence ? right : left;
  const fallback = winner === right ? left : right;
  const categoriesDisagree = left.category !== right.category;
  const categoryEvidence = categoriesDisagree
    ? [`category claim: ${left.category}`, `category claim: ${right.category}`]
    : [];
  return {
    ...winner,
    category: left.category === "unknown" || right.category === "unknown" ? "unknown" : winner.category,
    label: winner.label ?? fallback.label,
    manufacturer: winner.manufacturer ?? fallback.manufacturer,
    modelNumber: winner.modelNumber ?? fallback.modelNumber,
    specifications: [...new Set([...left.specifications, ...right.specifications])],
    evidence: [...new Set([...left.evidence, ...right.evidence, ...categoryEvidence])],
    sourceTileIds: [...new Set([...left.sourceTileIds, ...right.sourceTileIds])].sort(),
    overviewLocation: winner.overviewLocation,
    reviewRequired: true,
  };
}

export function consolidateVisionComponents(result: ValidatedVisionResult, rendered: RenderedCadDrawing): ComponentInput[] {
  const located = result.components.map<LocatedDetection>((detection) => ({
    ...detection,
    overviewLocation: toOverview(detection.location, rendered.tiles.find((tile) => tile.id === detection.tileId), rendered),
    sourceTileIds: [detection.tileId],
  }));
  const consolidated: LocatedDetection[] = [];
  for (const detection of located) {
    const duplicateIndex = consolidated.findIndex((existing) => compatible(existing, detection));
    if (duplicateIndex === -1) consolidated.push(detection);
    else consolidated[duplicateIndex] = merge(consolidated[duplicateIndex], detection);
  }

  return consolidated.map((detection) => ({
    temporaryId: detection.temporaryId,
    category: detection.category,
    tag: detection.label ?? undefined,
    description: detection.description,
    specifications: detection.specifications,
    manufacturer: detection.manufacturer,
    modelNumber: detection.modelNumber,
    confidence: detection.confidence,
    evidence: detection.evidence,
    method: "openai_vision",
    reviewStatus: detection.category === "unknown" ? "unknown" : "requires_review",
    sourceTileId: detection.sourceTileIds.join(","),
    location: detection.overviewLocation,
  }));
}
