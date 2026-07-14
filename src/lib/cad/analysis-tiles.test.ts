import { describe, expect, it } from "vitest";
import { getAnalysisTileGrid, getEntityBounds, normalizeAnalysisTileOptions, planAnalysisTiles } from "@/lib/cad/analysis-tiles";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import type { DxfExtents, NormalizedDxfDrawing, NormalizedDxfEntity } from "@/lib/cad/dxf-types";

function denseDrawing({
  entities,
  extents = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
}: {
  entities: number;
  extents?: DxfExtents;
}): NormalizedDxfDrawing {
  const columns = Math.ceil(Math.sqrt(entities));
  const width = extents.maxX - extents.minX;
  const height = extents.maxY - extents.minY;

  return {
    entities: Array.from({ length: entities }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = extents.minX + (column + 0.5) * width / columns;
      const y = extents.minY + (row + 0.5) * height / columns;
      return { type: "LINE", layer: "0", handle: String(index), points: [{ x, y }, { x: x + 1, y: y + 1 }], closed: false };
    }),
    blockDefinitions: {},
    layers: ["0"],
    blockNames: [],
    texts: [],
    extents,
    warnings: [],
  };
}

describe("planAnalysisTiles", () => {
  it("uses more than four occupied tiles for a dense wide drawing", () => {
    const drawing = denseDrawing({ entities: 1800, extents: { minX: 0, minY: 0, maxX: 5000, maxY: 900 } });
    const plan = planAnalysisTiles(drawing, { maxTiles: 24, overlapRatio: 0.1, targetEntitiesPerTile: 140 });
    expect(plan.tiles.length).toBeGreaterThan(4);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);
    expect(plan.limited).toBe(false);
    expect(plan.tiles.every((tile) => tile.entityCount > 0)).toBe(true);
  });

  it("marks coverage as limited when occupied cells exceed the cap", () => {
    const plan = planAnalysisTiles(denseDrawing({ entities: 5000 }), { maxTiles: 3, overlapRatio: 0.1, targetEntitiesPerTile: 50 });
    expect(plan.tiles).toHaveLength(3);
    expect(plan.limited).toBe(true);
    expect(plan.warnings).toContain("分析区域达到上限，部分图纸区域可能未完整扫描。");
  });

  it("clamps invalid and excessive planner options to safe limits", () => {
    expect(normalizeAnalysisTileOptions({ maxTiles: 0, overlapRatio: Number.NaN, targetEntitiesPerTile: -1 })).toEqual({ maxTiles: 24, overlapRatio: 0.1, targetEntitiesPerTile: 140 });
    expect(normalizeAnalysisTileOptions({ maxTiles: 9999, overlapRatio: 99, targetEntitiesPerTile: 999999 })).toEqual({ maxTiles: 64, overlapRatio: 0.5, targetEntitiesPerTile: 2000 });

    const plan = planAnalysisTiles(denseDrawing({ entities: 180 }), { maxTiles: 0, overlapRatio: -1, targetEntitiesPerTile: 0 });
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);
  });

  it("uses partial ARC and ELLIPSE bounds instead of full-shape bounds", () => {
    const drawing = denseDrawing({ entities: 0 });
    const arc: NormalizedDxfEntity = { type: "ARC", layer: "0", handle: "arc", center: { x: 50, y: 50 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 };
    const ellipse: NormalizedDxfEntity = { type: "ELLIPSE", layer: "0", handle: "ellipse", center: { x: 50, y: 50 }, majorAxis: { x: 10, y: 0 }, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI / 2 };

    expect(getEntityBounds(arc, drawing)).toMatchObject({ minX: 50, minY: 50, maxX: 60, maxY: 60 });
    expect(getEntityBounds(ellipse, drawing)).toMatchObject({ minX: 50, minY: 50, maxX: 60, maxY: 55 });
  });

  it("caps grid cells for an extreme drawing aspect ratio", () => {
    const grid = getAnalysisTileGrid(64, Number.MAX_VALUE);

    expect(grid.rows * grid.columns).toBeLessThanOrEqual(64);
    expect(grid.columns).toBeLessThanOrEqual(64);
  });

  it("rotates ELLIPSE bounds and SVG points using majorAxis direction", () => {
    const drawing = denseDrawing({ entities: 0 });
    const ellipse: NormalizedDxfEntity = { type: "ELLIPSE", layer: "0", handle: "rotated", center: { x: 50, y: 50 }, majorAxis: { x: 0, y: 10 }, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2 };
    drawing.entities = [ellipse];
    drawing.extents = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    expect(getEntityBounds(ellipse, drawing)).toMatchObject({ minX: 45, minY: 40, maxX: 55, maxY: 60 });
    expect(renderDxfSvg(drawing, { maxWidth: 100, maxHeight: 100, padding: 0 }).svg).toContain('points="50.00,40.00');
  });

  it("orders occupied cells top-to-bottom and counts text and INSERT entities", () => {
    const drawing = denseDrawing({ entities: 4 });
    drawing.entities.push(
      { type: "TEXT", layer: "0", handle: "text", position: { x: 250, y: 750 }, value: "KM1", height: 20, rotation: 0 },
      { type: "INSERT", layer: "0", handle: "insert", blockName: "CONTACT", position: { x: 750, y: 750 }, scaleX: 1, scaleY: 1, rotation: 0 },
    );
    drawing.blockDefinitions.CONTACT = [{ type: "LINE", layer: "0", handle: "block-line", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], closed: false }];
    const plan = planAnalysisTiles(drawing, { maxTiles: 24, overlapRatio: 0, targetEntitiesPerTile: 1 });

    expect(plan.tiles[0].cadBounds.minY).toBeGreaterThan(plan.tiles[2].cadBounds.minY);
    expect(plan.tiles[0].cadBounds.minX).toBeLessThan(plan.tiles[1].cadBounds.minX);
    expect(plan.tiles.some((tile) => tile.textCount > 0)).toBe(true);
    expect(plan.tiles.some((tile) => tile.blockCount > 0)).toBe(true);
  });
});
