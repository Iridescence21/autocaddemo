import { describe, expect, it } from "vitest";
import { planAnalysisTiles } from "@/lib/cad/analysis-tiles";
import type { DxfExtents, NormalizedDxfDrawing } from "@/lib/cad/dxf-types";

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
});
