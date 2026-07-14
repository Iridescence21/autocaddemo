import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeDxfBuffer, parseDxfFile } from "@/lib/cad/dxf-parser";

describe("DXF parser", () => {
  it("decodes ANSI_936 DXF text as GBK before parsing", () => {
    const header = Buffer.from("0\nSECTION\n2\nHEADER\n9\n$DWGCODEPAGE\n3\nANSI_936\n0\nENDSEC\n", "ascii");
    const chinese = Buffer.from("b5e7c1f7bcccb5e7c6f7", "hex");

    expect(decodeDxfBuffer(Buffer.concat([header, chinese]))).toContain("电流继电器");
  });

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
