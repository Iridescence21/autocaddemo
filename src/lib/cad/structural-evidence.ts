import type { ComponentCategory } from "@/lib/domain";
import type { DxfPoint, NormalizedDxfDrawing } from "@/lib/cad/dxf-types";
import type { RenderedCadDrawing } from "@/lib/cad/types";

export type StructuralTextEvidence = {
  id: string;
  rawText: string;
  tag: string;
  category: ComponentCategory;
  handle: string | null;
  layer: string;
  cadPosition: DxfPoint;
  overviewPosition: DxfPoint;
  confidence: number;
  method: "cad_native_text";
};

export type StructuralEvidenceSearchOptions = {
  margin?: number;
  maxDistance?: number;
};

const OVERVIEW_PADDING = 48;

const CATEGORY_BY_PREFIX: Record<string, ComponentCategory> = {
  QF: "circuit_breaker",
  FU: "fuse",
  KM: "contactor",
  KA: "relay",
  KC: "relay",
  KT: "relay",
  YCT: "relay",
  TA: "transformer",
  TV: "transformer",
  T: "transformer",
  QS: "switch",
  SA: "switch",
  SB: "push_button",
  KS: "switch",
  XT: "terminal_block",
  XB: "terminal_block",
  X: "terminal_block",
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function parseDeviceTags(rawText: string): Array<{ tag: string; category: ComponentCategory }> {
  const normalized = rawText.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^([A-Z]{1,4})(\d+)((?:,\d+)*)(?::[^\s]+)?$/);
  if (!match) return [];
  const [, prefix, firstNumber, commaNumbers] = match;
  const category = CATEGORY_BY_PREFIX[prefix];
  if (!category) return [];
  const numbers = [firstNumber, ...commaNumbers.split(",").filter(Boolean)];
  return [...new Set(numbers)].map((number) => ({ tag: `${prefix}${number}`, category }));
}

function cadPointToOverview(point: DxfPoint, drawing: NormalizedDxfDrawing, rendered: RenderedCadDrawing): DxfPoint {
  const cadWidth = Math.max(1, drawing.extents.maxX - drawing.extents.minX);
  const cadHeight = Math.max(1, drawing.extents.maxY - drawing.extents.minY);
  const scale = Math.max(0.01, Math.min(
    (rendered.width - OVERVIEW_PADDING * 2) / cadWidth,
    (rendered.height - OVERVIEW_PADDING * 2) / cadHeight,
  ));
  return {
    x: clamp((OVERVIEW_PADDING + (point.x - drawing.extents.minX) * scale) / rendered.width),
    y: clamp((rendered.height - OVERVIEW_PADDING - (point.y - drawing.extents.minY) * scale) / rendered.height),
  };
}

export function buildStructuralEvidence(drawing: NormalizedDxfDrawing, rendered: RenderedCadDrawing): StructuralTextEvidence[] {
  return drawing.texts.flatMap((text, textIndex) => parseDeviceTags(text.value).map((candidate) => ({
    id: `cad-text:${text.handle ?? `index-${textIndex}`}:${candidate.tag}`,
    rawText: text.value,
    tag: candidate.tag,
    category: candidate.category,
    handle: text.handle,
    layer: text.layer,
    cadPosition: text.position,
    overviewPosition: cadPointToOverview(text.position, drawing, rendered),
    confidence: 0.99,
    method: "cad_native_text" as const,
  })));
}

function pointDistance(left: DxfPoint, right: DxfPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function findNearbyStructuralEvidence(
  evidence: StructuralTextEvidence[],
  location: { x: number; y: number; width: number; height: number },
  options: StructuralEvidenceSearchOptions = {},
) {
  const margin = options.margin ?? 0.025;
  const maxDistance = options.maxDistance ?? 0.08;
  const center = { x: location.x + location.width / 2, y: location.y + location.height / 2 };
  const contains = (point: DxfPoint) => point.x >= location.x - margin
    && point.x <= location.x + location.width + margin
    && point.y >= location.y - margin
    && point.y <= location.y + location.height + margin;

  return evidence
    .map((item) => ({ item, inside: contains(item.overviewPosition), distance: pointDistance(center, item.overviewPosition) }))
    .filter((candidate) => candidate.inside || candidate.distance <= maxDistance)
    .sort((left, right) => Number(right.inside) - Number(left.inside) || left.distance - right.distance)
    .map((candidate) => candidate.item);
}
