import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDxfFile } from "@/lib/cad/dxf-parser";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import { dxfRenderer } from "@/lib/cad/dxf-renderer";

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
});
