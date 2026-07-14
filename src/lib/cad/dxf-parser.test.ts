import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDxfFile } from "@/lib/cad/dxf-parser";

describe("DXF parser", () => {
  it("normalizes geometry, layers, blocks, text, and extents", async () => {
    const drawing = await parseDxfFile(resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf"));

    expect(drawing.entities.some((entity) => entity.type === "LINE")).toBe(true);
    expect(drawing.entities.some((entity) => entity.type === "INSERT")).toBe(true);
    expect(drawing.texts.map((text) => text.value)).toContain("KM1");
    expect(drawing.layers).toContain("WIRE");
    expect(drawing.blockNames).toContain("CONTACTOR_COIL");
    expect(drawing.extents.maxX).toBeGreaterThan(drawing.extents.minX);
    expect(drawing.extents.maxY).toBeGreaterThan(drawing.extents.minY);
  });
});
