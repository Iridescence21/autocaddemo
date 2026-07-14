import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDxfFile } from "@/lib/cad/dxf-parser";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import { createDxfRenderer, dxfRenderer, readCadAnalysisTileConfig } from "@/lib/cad/dxf-renderer";

const fixture = resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf");

describe("DXF renderer", () => {
  it("renders normalized geometry and escaped text to SVG", async () => {
    const drawing = await parseDxfFile(fixture);
    const rendered = renderDxfSvg(drawing, { maxWidth: 1600, maxHeight: 1200 });

    expect(rendered.svg).toContain("<line");
    expect(rendered.svg).toContain("<circle");
    expect(rendered.svg).toContain("KM1");
    expect(rendered.width).toBeGreaterThan(0);
    expect(rendered.height).toBeGreaterThan(0);
  });

  it("rasterizes one overview and occupied vector-backed PNG tiles", async () => {
    const rendered = await dxfRenderer.render({ drawingId: "drawing-real-dxf", sourcePath: fixture, sourceType: "dxf" });

    expect(rendered.overviewImageUrl).toMatch(/^data:image\/png;base64,/);
    expect(rendered.tiles.length).toBeGreaterThan(0);
    expect(rendered.tiles.every((tile) => tile.imageUrl.startsWith("data:image/png;base64,"))).toBe(true);
    expect(rendered.tiles.every((tile) => tile.overlap > 0)).toBe(true);
    expect(rendered.tiles.every((tile) => tile.width > 0 && tile.height > 0)).toBe(true);
    expect(rendered.tiles.every((tile) => tile.cadBounds && tile.entityCount > 0)).toBe(true);
    expect(rendered.metadata?.coverageLimited).toBe(false);
    expect(rendered.metadata?.context?.texts.map((text) => text.value)).toContain("KM1");
  });

  it("uses safe defaults and clamps environment tile settings", () => {
    expect(readCadAnalysisTileConfig({})).toEqual({ tilePixels: 1536, maxTiles: 24, overlapRatio: 0.1, targetEntitiesPerTile: 140, renderConcurrency: 4, renderTimeoutMs: 15000 });
    expect(readCadAnalysisTileConfig({
      CAD_ANALYSIS_TILE_PIXELS: "99999",
      CAD_ANALYSIS_MAX_TILES: "0",
      CAD_ANALYSIS_TILE_OVERLAP_RATIO: "2",
      CAD_ANALYSIS_TARGET_ENTITIES_PER_TILE: "-1",
      CAD_ANALYSIS_TILE_RENDER_CONCURRENCY: "999",
      CAD_ANALYSIS_TILE_RENDER_TIMEOUT_MS: "NaN",
    })).toEqual({ tilePixels: 4096, maxTiles: 1, overlapRatio: 0.5, targetEntitiesPerTile: 1, renderConcurrency: 8, renderTimeoutMs: 15000 });
    expect(readCadAnalysisTileConfig({ CAD_ANALYSIS_TILE_RENDER_TIMEOUT_MS: "100" }).renderTimeoutMs).toBe(1000);
  });

  it("keeps successful tiles and warns when a native-bounded tile fails", async () => {
    const renderer = createDxfRenderer({
      environment: {
        CAD_ANALYSIS_TARGET_ENTITIES_PER_TILE: "1",
        CAD_ANALYSIS_TILE_RENDER_TIMEOUT_MS: "1000",
        CAD_ANALYSIS_TILE_RENDER_CONCURRENCY: "2",
      },
      rasterizeTile: async (_svg, tile, timeoutMs) => {
        expect(timeoutMs).toBe(1000);
        if (tile.id === "tile-1") throw new Error("NATIVE_RASTER_TIMEOUT");
        return Buffer.from(tile.id);
      },
    });

    const rendered = await renderer.render({ drawingId: "drawing-partial-failure", sourcePath: fixture, sourceType: "dxf" });

    expect(rendered.tiles.length).toBeGreaterThan(0);
    expect(rendered.tiles.map((tile) => tile.id)).not.toContain("tile-1");
    expect(rendered.metadata?.coverageLimited).toBe(true);
    expect(rendered.metadata?.context?.warnings).toContain("部分分析区域渲染失败，可能未完整扫描。");
  });

  it("throws a stable error when every planned tile fails", async () => {
    const renderer = createDxfRenderer({
      environment: { CAD_ANALYSIS_TARGET_ENTITIES_PER_TILE: "1" },
      rasterizeTile: async () => { throw new Error("RASTER_FAILURE"); },
    });

    await expect(renderer.render({ drawingId: "drawing-total-failure", sourcePath: fixture, sourceType: "dxf" })).rejects.toThrow("DXF_ANALYSIS_TILE_RENDER_FAILED");
  });

  it("starts a queued tile after a timeout-aware raster rejects at concurrency one", async () => {
    const started: string[] = [];
    const renderer = createDxfRenderer({
      environment: {
        CAD_ANALYSIS_TARGET_ENTITIES_PER_TILE: "1",
        CAD_ANALYSIS_TILE_RENDER_CONCURRENCY: "1",
        CAD_ANALYSIS_TILE_RENDER_TIMEOUT_MS: "1000",
      },
      rasterizeTile: async (_svg, tile, timeoutMs) => {
        started.push(tile.id);
        expect(timeoutMs).toBe(1000);
        if (tile.id === "tile-1") throw new Error("NATIVE_RASTER_TIMEOUT");
        return Buffer.from(tile.id);
      },
    });

    const rendered = await renderer.render({ drawingId: "drawing-queued-after-timeout", sourcePath: fixture, sourceType: "dxf" });

    expect(started.slice(0, 2)).toEqual(["tile-1", "tile-2"]);
    expect(rendered.tiles.map((tile) => tile.id)).not.toContain("tile-1");
    expect(rendered.metadata?.coverageLimited).toBe(true);
  });
});
