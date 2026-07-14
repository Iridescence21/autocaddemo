import type { DxfExtents, DxfPoint, NormalizedDxfDrawing, NormalizedDxfEntity } from "@/lib/cad/dxf-types";

export type AnalysisTileOptions = {
  maxTiles: number;
  overlapRatio: number;
  targetEntitiesPerTile: number;
};

export type AnalysisTilePlan = {
  tiles: Array<{ id: string; cadBounds: DxfExtents; entityCount: number; textCount: number; blockCount: number }>;
  limited: boolean;
  warnings: string[];
};

type OccupiedCell = Omit<AnalysisTilePlan["tiles"][number], "id">;

function intersects(left: DxfExtents, right: DxfExtents) {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

function bounds(points: DxfPoint[]): DxfExtents | undefined {
  if (!points.length) return undefined;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function entityBounds(entity: NormalizedDxfEntity, drawing: NormalizedDxfDrawing, depth = 0): DxfExtents | undefined {
  if (entity.type === "LINE" || entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") return bounds(entity.points);
  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    return { minX: entity.center.x - entity.radius, minY: entity.center.y - entity.radius, maxX: entity.center.x + entity.radius, maxY: entity.center.y + entity.radius };
  }
  if (entity.type === "ELLIPSE") {
    const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
    const radius = Math.max(major, major * entity.axisRatio);
    return { minX: entity.center.x - radius, minY: entity.center.y - radius, maxX: entity.center.x + radius, maxY: entity.center.y + radius };
  }
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    return {
      minX: entity.position.x,
      minY: entity.position.y,
      maxX: entity.position.x + Math.max(entity.height, entity.value.length * entity.height * 0.65),
      maxY: entity.position.y + entity.height,
    };
  }
  if (entity.type !== "INSERT") return undefined;
  if (depth > 8) return { minX: entity.position.x, minY: entity.position.y, maxX: entity.position.x, maxY: entity.position.y };
  const children = drawing.blockDefinitions[entity.blockName] ?? [];
  const childBounds = children.map((child) => entityBounds(child, drawing, depth + 1)).filter((item): item is DxfExtents => Boolean(item));
  if (!childBounds.length) return { minX: entity.position.x, minY: entity.position.y, maxX: entity.position.x, maxY: entity.position.y };
  const radians = entity.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const points = childBounds.flatMap((child) => [
    { x: child.minX, y: child.minY },
    { x: child.minX, y: child.maxY },
    { x: child.maxX, y: child.minY },
    { x: child.maxX, y: child.maxY },
  ].map((point) => ({
    x: entity.position.x + (point.x * entity.scaleX) * cosine - (point.y * entity.scaleY) * sine,
    y: entity.position.y + (point.x * entity.scaleX) * sine + (point.y * entity.scaleY) * cosine,
  })));
  return bounds(points);
}

function buildOccupiedCells(drawing: NormalizedDxfDrawing, rows: number, columns: number, overlapRatio: number): OccupiedCell[] {
  const cellWidth = (drawing.extents.maxX - drawing.extents.minX) / columns;
  const cellHeight = (drawing.extents.maxY - drawing.extents.minY) / rows;
  const overlapX = cellWidth * overlapRatio;
  const overlapY = cellHeight * overlapRatio;
  const entities = drawing.entities.map((entity) => ({ entity, bounds: entityBounds(entity, drawing) })).filter((item): item is { entity: NormalizedDxfEntity; bounds: DxfExtents } => Boolean(item.bounds));
  const cells: OccupiedCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const baseMinX = drawing.extents.minX + column * cellWidth;
      const baseMaxX = column === columns - 1 ? drawing.extents.maxX : baseMinX + cellWidth;
      const baseMaxY = drawing.extents.maxY - row * cellHeight;
      const baseMinY = row === rows - 1 ? drawing.extents.minY : baseMaxY - cellHeight;
      const cadBounds = {
        minX: Math.max(drawing.extents.minX, baseMinX - overlapX),
        minY: Math.max(drawing.extents.minY, baseMinY - overlapY),
        maxX: Math.min(drawing.extents.maxX, baseMaxX + overlapX),
        maxY: Math.min(drawing.extents.maxY, baseMaxY + overlapY),
      };
      const supported = entities.filter((item) => intersects(item.bounds, cadBounds)).map((item) => item.entity);
      if (!supported.length) continue;
      cells.push({
        cadBounds,
        entityCount: supported.length,
        textCount: supported.filter((entity) => entity.type === "TEXT" || entity.type === "MTEXT").length,
        blockCount: supported.filter((entity) => entity.type === "INSERT").length,
      });
    }
  }
  return cells;
}

export function planAnalysisTiles(drawing: NormalizedDxfDrawing, options: AnalysisTileOptions): AnalysisTilePlan {
  const desired = Math.max(1, Math.ceil(drawing.entities.length / options.targetEntitiesPerTile));
  const aspect = Math.max(0.1, (drawing.extents.maxX - drawing.extents.minX) / (drawing.extents.maxY - drawing.extents.minY));
  const columns = Math.max(1, Math.ceil(Math.sqrt(desired * aspect)));
  const rows = Math.max(1, Math.ceil(desired / columns));
  const occupied = buildOccupiedCells(drawing, rows, columns, options.overlapRatio);
  const limited = occupied.length > options.maxTiles;
  return {
    tiles: occupied.slice(0, options.maxTiles).map((tile, index) => ({ ...tile, id: `tile-${index + 1}` })),
    limited,
    warnings: limited ? ["分析区域达到上限，部分图纸区域可能未完整扫描。"] : [],
  };
}
