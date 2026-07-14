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

function centersAreNear(left: VisionLocation, right: VisionLocation) {
  const leftCenter = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  const rightCenter = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
  const distance = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
  const reference = Math.max(Math.hypot(left.width, left.height), Math.hypot(right.width, right.height));
  return reference > 0 && distance <= reference * 0.18;
}

function compatible(left: LocatedDetection, right: LocatedDetection) {
  const categoriesMatch = left.category === right.category || left.category === "unknown" || right.category === "unknown";
  if (!categoriesMatch) return false;
  if (left.label && right.label && left.label.trim().toLowerCase() !== right.label.trim().toLowerCase()) return false;
  return intersectionOverUnion(left.overviewLocation, right.overviewLocation) > 0.45 || centersAreNear(left.overviewLocation, right.overviewLocation);
}

function unionLocation(left: VisionLocation, right: VisionLocation): VisionLocation {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: clamp(maxX - x), height: clamp(maxY - y) };
}

function merge(left: LocatedDetection, right: LocatedDetection): LocatedDetection {
  const winner = right.confidence > left.confidence ? right : left;
  const fallback = winner === right ? left : right;
  return {
    ...winner,
    label: winner.label ?? fallback.label,
    manufacturer: winner.manufacturer ?? fallback.manufacturer,
    modelNumber: winner.modelNumber ?? fallback.modelNumber,
    specifications: [...new Set([...left.specifications, ...right.specifications])],
    evidence: [...new Set([...left.evidence, ...right.evidence])],
    sourceTileIds: [...new Set([...left.sourceTileIds, ...right.sourceTileIds])].sort(),
    overviewLocation: unionLocation(left.overviewLocation, right.overviewLocation),
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
