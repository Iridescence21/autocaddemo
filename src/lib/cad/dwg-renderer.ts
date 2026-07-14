import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libreDwgConverter, type DwgConverter } from "@/lib/cad/dwg-converter";
import { dxfRenderer } from "@/lib/cad/dxf-renderer";
import type { CadRenderAdapter } from "@/lib/cad/types";

export function createDwgRenderer(
  converter: DwgConverter = libreDwgConverter,
  downstreamRenderer: CadRenderAdapter = dxfRenderer,
): CadRenderAdapter {
  return {
    async render(input) {
      if (input.sourceType !== "dwg") throw new Error("DWG_RENDERER_SOURCE_TYPE_MISMATCH");
      const outputDir = await mkdtemp(join(tmpdir(), "dwg-electrical-"));
      try {
        const sourcePath = await converter.convert({ sourcePath: input.sourcePath, outputDir });
        return await downstreamRenderer.render({ drawingId: input.drawingId, sourcePath, sourceType: "dxf" });
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
  };
}

export const dwgRenderer = createDwgRenderer();
