import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDwgRenderer } from "./dwg-renderer";
import type { DwgConverter } from "./dwg-converter";
import type { CadRenderAdapter, RenderedCadDrawing } from "./types";

const rendered: RenderedCadDrawing = {
  overviewImageUrl: "data:image/png;base64,overview",
  width: 1,
  height: 1,
  tiles: [],
};

async function makeDwgSource() {
  const directory = await mkdtemp(join(tmpdir(), "dwg-renderer-source-"));
  const sourcePath = join(directory, "panel.dwg");
  await writeFile(sourcePath, "DWG");
  return { directory, sourcePath };
}

describe("DWG renderer", () => {
  it("converts the DWG and delegates its DXF to the downstream renderer", async () => {
    const source = await makeDwgSource();
    let conversion: { sourcePath: string; outputDir: string } | undefined;
    let downstreamInput: Parameters<CadRenderAdapter["render"]>[0] | undefined;
    const converter: DwgConverter = {
      async convert(input) {
        conversion = input;
        const convertedPath = join(input.outputDir, "panel.dxf");
        await writeFile(convertedPath, "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n");
        return convertedPath;
      },
    };
    const downstreamRenderer: CadRenderAdapter = {
      async render(input) {
        downstreamInput = input;
        return rendered;
      },
    };

    try {
      const result = await createDwgRenderer(converter, downstreamRenderer).render({
        drawingId: "drawing-1",
        sourcePath: source.sourcePath,
        sourceType: "dwg",
      });

      const convertedPath = join(conversion!.outputDir, "panel.dxf");
      expect(conversion?.sourcePath).toBe(source.sourcePath);
      expect(downstreamInput).toEqual({ drawingId: "drawing-1", sourcePath: convertedPath, sourceType: "dxf" });
      expect(result).toBe(rendered);
      await expect(access(conversion!.outputDir)).rejects.toThrow();
    } finally {
      await rm(source.directory, { recursive: true, force: true });
    }
  });

  it("removes the conversion directory when the downstream renderer fails", async () => {
    const source = await makeDwgSource();
    let conversionDirectory: string | undefined;
    const converter: DwgConverter = {
      async convert(input) {
        conversionDirectory = input.outputDir;
        const convertedPath = join(input.outputDir, "panel.dxf");
        await writeFile(convertedPath, "0\nEOF\n");
        return convertedPath;
      },
    };
    const downstreamRenderer: CadRenderAdapter = {
      async render() {
        throw new Error("DOWNSTREAM_RENDER_FAILED");
      },
    };

    try {
      await expect(createDwgRenderer(converter, downstreamRenderer).render({
        drawingId: "drawing-1",
        sourcePath: source.sourcePath,
        sourceType: "dwg",
      })).rejects.toThrow("DOWNSTREAM_RENDER_FAILED");

      await expect(access(conversionDirectory!)).rejects.toThrow();
    } finally {
      await rm(source.directory, { recursive: true, force: true });
    }
  });
});
