import type { DxfExtents, DxfPoint, NormalizedDxfDrawing, NormalizedDxfEntity } from "@/lib/cad/dxf-types";

type Affine = [number, number, number, number, number, number];
export type SvgOptions = { maxWidth?: number; maxHeight?: number; padding?: number; viewport?: DxfExtents };
export type DxfSvgRenderResult = { svg: string; width: number; height: number };

const identity: Affine = [1, 0, 0, 1, 0, 0];

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function transform(point: DxfPoint, matrix: Affine): DxfPoint {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

function multiply(left: Affine, right: Affine): Affine {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function insertMatrix(entity: Extract<NormalizedDxfEntity, { type: "INSERT" }>): Affine {
  const radians = entity.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine * entity.scaleX, sine * entity.scaleX, -sine * entity.scaleY, cosine * entity.scaleY, entity.position.x, entity.position.y];
}

function sampledArc(center: DxfPoint, radiusX: number, radiusY: number, start: number, end: number, matrix: Affine) {
  let from = start;
  let to = end;
  if (to <= from) to += Math.PI * 2;
  if (to - from > Math.PI * 2) to = from + Math.PI * 2;
  const steps = Math.max(12, Math.ceil((to - from) / (Math.PI / 18)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + (to - from) * (index / steps);
    return transform({ x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY }, matrix);
  });
}

export function renderDxfSvg(drawing: NormalizedDxfDrawing, options: SvgOptions = {}): DxfSvgRenderResult {
  const maxWidth = options.maxWidth ?? 2048;
  const maxHeight = options.maxHeight ?? 1536;
  const padding = options.padding ?? 48;
  const viewport = options.viewport ?? drawing.extents;
  const cadWidth = Math.max(1, viewport.maxX - viewport.minX);
  const cadHeight = Math.max(1, viewport.maxY - viewport.minY);
  const scale = Math.max(0.01, Math.min((maxWidth - padding * 2) / cadWidth, (maxHeight - padding * 2) / cadHeight));
  const width = Math.max(1, Math.ceil(cadWidth * scale + padding * 2));
  const height = Math.max(1, Math.ceil(cadHeight * scale + padding * 2));
  const screen = (input: DxfPoint) => ({
    x: padding + (input.x - viewport.minX) * scale,
    y: height - padding - (input.y - viewport.minY) * scale,
  });
  const pointList = (points: DxfPoint[]) => points.map((item) => {
    const value = screen(item);
    return `${value.x.toFixed(2)},${value.y.toFixed(2)}`;
  }).join(" ");

  const renderEntity = (entity: NormalizedDxfEntity, parent: Affine, depth = 0): string => {
    if (depth > 8) return "";
    const strokeWidth = Math.max(1, Math.min(3, scale * 0.06));
    const style = `fill="none" stroke="#172033" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"`;
    if (entity.type === "LINE") {
      if (entity.points.length < 2) return "";
      const start = screen(transform(entity.points[0], parent));
      const end = screen(transform(entity.points[1], parent));
      return `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" ${style}/>`;
    }
    if (entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
      const points = pointList(entity.points.map((item) => transform(item, parent)));
      return entity.closed ? `<polygon points="${points}" ${style}/>` : `<polyline points="${points}" ${style}/>`;
    }
    if (entity.type === "CIRCLE") {
      const center = screen(transform(entity.center, parent));
      const xEdge = screen(transform({ x: entity.center.x + entity.radius, y: entity.center.y }, parent));
      const yEdge = screen(transform({ x: entity.center.x, y: entity.center.y + entity.radius }, parent));
      const rx = Math.hypot(xEdge.x - center.x, xEdge.y - center.y);
      const ry = Math.hypot(yEdge.x - center.x, yEdge.y - center.y);
      if (Math.abs(rx - ry) < 0.01) return `<circle cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="${rx.toFixed(2)}" ${style}/>`;
      return `<ellipse cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" ${style}/>`;
    }
    if (entity.type === "ARC") {
      return `<polyline points="${pointList(sampledArc(entity.center, entity.radius, entity.radius, entity.startAngle, entity.endAngle, parent))}" ${style}/>`;
    }
    if (entity.type === "ELLIPSE") {
      const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
      return `<polyline points="${pointList(sampledArc(entity.center, major, major * entity.axisRatio, entity.startAngle, entity.endAngle, parent))}" ${style}/>`;
    }
    if (entity.type === "TEXT" || entity.type === "MTEXT") {
      const position = screen(transform(entity.position, parent));
      const fontSize = Math.max(9, Math.min(40, entity.height * scale));
      return `<text x="${position.x.toFixed(2)}" y="${position.y.toFixed(2)}" fill="#172033" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}">${escapeXml(entity.value)}</text>`;
    }
    if (entity.type !== "INSERT") return "";
    const insert = entity as Extract<NormalizedDxfEntity, { type: "INSERT" }>;
    const block = drawing.blockDefinitions[insert.blockName] ?? [];
    const next = multiply(parent, insertMatrix(insert));
    return block.map((child) => renderEntity(child, next, depth + 1)).join("");
  };

  const content = drawing.entities.map((entity) => renderEntity(entity, identity)).join("");
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f8fafc"/>${content}</svg>`,
  };
}
