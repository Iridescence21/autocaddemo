import { readFile } from "node:fs/promises";
import DxfParser, { type IDxf, type IEntity } from "dxf-parser";
import type { DxfExtents, DxfPoint, NormalizedDxfDrawing, NormalizedDxfEntity } from "@/lib/cad/dxf-types";

type RawEntity = IEntity & Record<string, unknown>;

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function point(value: unknown): DxfPoint {
  const source = (value ?? {}) as Record<string, unknown>;
  return { x: number(source.x), y: number(source.y) };
}

function base(entity: RawEntity) {
  return {
    layer: typeof entity.layer === "string" ? entity.layer : "0",
    handle: entity.handle === undefined || entity.handle === null ? null : String(entity.handle),
  };
}

function normalizeEntity(entity: RawEntity): NormalizedDxfEntity | null {
  const common = base(entity);
  if (entity.type === "LINE" || entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") {
    const vertices = Array.isArray(entity.vertices) ? entity.vertices : [];
    return {
      ...common,
      type: entity.type,
      points: vertices.map(point),
      closed: Boolean(entity.shape),
    };
  }
  if (entity.type === "CIRCLE") {
    return { ...common, type: "CIRCLE", center: point(entity.center), radius: Math.abs(number(entity.radius)) };
  }
  if (entity.type === "ARC") {
    return {
      ...common,
      type: "ARC",
      center: point(entity.center),
      radius: Math.abs(number(entity.radius)),
      startAngle: number(entity.startAngle),
      endAngle: number(entity.endAngle, Math.PI * 2),
    };
  }
  if (entity.type === "ELLIPSE") {
    return {
      ...common,
      type: "ELLIPSE",
      center: point(entity.center),
      majorAxis: point(entity.majorAxisEndPoint),
      axisRatio: Math.abs(number(entity.axisRatio, 1)),
      startAngle: number(entity.startAngle),
      endAngle: number(entity.endAngle, Math.PI * 2),
    };
  }
  if (entity.type === "TEXT") {
    return {
      ...common,
      type: "TEXT",
      position: point(entity.startPoint),
      value: String(entity.text ?? "").trim(),
      height: Math.abs(number(entity.textHeight, 1)),
      rotation: number(entity.rotation),
    };
  }
  if (entity.type === "MTEXT") {
    return {
      ...common,
      type: "MTEXT",
      position: point(entity.position),
      value: String(entity.text ?? "").replaceAll("\\P", "\n").trim(),
      height: Math.abs(number(entity.height, 1)),
      rotation: number(entity.rotation),
    };
  }
  if (entity.type === "INSERT") {
    return {
      ...common,
      type: "INSERT",
      blockName: String(entity.name ?? ""),
      position: point(entity.position),
      scaleX: number(entity.xScale, 1),
      scaleY: number(entity.yScale, 1),
      rotation: number(entity.rotation),
    };
  }
  return null;
}

function pointsForEntity(entity: NormalizedDxfEntity, blocks: Record<string, NormalizedDxfEntity[]>): DxfPoint[] {
  if (entity.type === "LINE" || entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") return entity.points;
  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    return [
      { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
      { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius },
    ];
  }
  if (entity.type === "ELLIPSE") {
    const major = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
    const radius = Math.max(major, major * entity.axisRatio);
    return [
      { x: entity.center.x - radius, y: entity.center.y - radius },
      { x: entity.center.x + radius, y: entity.center.y + radius },
    ];
  }
  if (entity.type === "TEXT" || entity.type === "MTEXT") {
    return [entity.position, { x: entity.position.x + Math.max(entity.height, entity.value.length * entity.height * 0.65), y: entity.position.y + entity.height }];
  }
  if (entity.type !== "INSERT") return [];
  const insert = entity as Extract<NormalizedDxfEntity, { type: "INSERT" }>;
  const radians = insert.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const blockPoints = (blocks[insert.blockName] ?? []).flatMap((child) => pointsForEntity(child, {}));
  if (!blockPoints.length) return [insert.position];
  return blockPoints.map((child) => {
    const x = child.x * insert.scaleX;
    const y = child.y * insert.scaleY;
    return {
      x: insert.position.x + x * cosine - y * sine,
      y: insert.position.y + x * sine + y * cosine,
    };
  });
}

function calculateExtents(entities: NormalizedDxfEntity[], blocks: Record<string, NormalizedDxfEntity[]>): DxfExtents {
  const points = entities.flatMap((entity) => pointsForEntity(entity, blocks)).filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const minX = Math.min(...points.map((item) => item.x));
  const minY = Math.min(...points.map((item) => item.y));
  const maxX = Math.max(...points.map((item) => item.x));
  const maxY = Math.max(...points.map((item) => item.y));
  return { minX, minY, maxX: maxX === minX ? maxX + 1 : maxX, maxY: maxY === minY ? maxY + 1 : maxY };
}

function unitsFromHeader(dxf: IDxf) {
  const code = dxf.header?.$INSUNITS;
  const units: Record<number, string> = { 0: "unitless", 1: "inches", 2: "feet", 4: "millimeters", 5: "centimeters", 6: "meters" };
  return typeof code === "number" ? units[code] : undefined;
}

export function parseDxfText(source: string): NormalizedDxfDrawing {
  const parsed = new DxfParser().parseSync(source);
  if (!parsed) throw new Error("DXF_PARSE_FAILED");

  const warnings = new Set<string>();
  const normalizeAll = (items: IEntity[] = []) => items.flatMap((raw) => {
    const normalized = normalizeEntity(raw as RawEntity);
    if (!normalized) warnings.add(`Unsupported DXF entity: ${raw.type}`);
    return normalized ? [normalized] : [];
  });
  const blockDefinitions = Object.fromEntries(Object.entries(parsed.blocks ?? {}).map(([name, block]) => [name, normalizeAll(block.entities ?? [])]));
  const entities = normalizeAll(parsed.entities ?? []);
  const layers = new Set<string>([
    ...Object.keys(parsed.tables?.layer?.layers ?? {}),
    ...entities.map((entity) => entity.layer),
  ]);
  const texts = entities
    .filter((entity): entity is Extract<NormalizedDxfEntity, { type: "TEXT" | "MTEXT" }> => entity.type === "TEXT" || entity.type === "MTEXT")
    .map((entity) => ({ value: entity.value, layer: entity.layer, handle: entity.handle, position: entity.position }));

  return {
    entities,
    blockDefinitions,
    layers: [...layers].sort(),
    blockNames: Object.keys(blockDefinitions).sort(),
    texts,
    extents: calculateExtents(entities, blockDefinitions),
    units: unitsFromHeader(parsed),
    warnings: [...warnings],
  };
}

export function decodeDxfBuffer(source: Buffer) {
  const headerProbe = source.subarray(0, Math.min(source.length, 16384)).toString("latin1").toUpperCase();
  if (/ANSI_(?:936|950)|\bGBK\b|\bGB2312\b/.test(headerProbe)) {
    return new TextDecoder("gbk").decode(source);
  }
  return new TextDecoder("utf-8").decode(source);
}

export async function parseDxfFile(sourcePath: string) {
  return parseDxfText(decodeDxfBuffer(await readFile(sourcePath)));
}
