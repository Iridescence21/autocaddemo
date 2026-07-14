import sharp from "sharp";
import { planAnalysisTiles } from "@/lib/cad/analysis-tiles";
import { parseDxfFile } from "@/lib/cad/dxf-parser";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import type { CadDrawingTile, CadRenderAdapter } from "@/lib/cad/types";

const CAD_ANALYSIS_TILE_PIXELS = 1536;
const ANALYSIS_TILE_OPTIONS = { maxTiles: 24, overlapRatio: 0.1, targetEntitiesPerTile: 140 };
const CAD_OVERVIEW_MAX_WIDTH = 2048;
const CAD_OVERVIEW_MAX_HEIGHT = 1536;
const CAD_OVERVIEW_PADDING = 48;

function dataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export const dxfRenderer: CadRenderAdapter = {
  async render(input) {
    if (input.sourceType !== "dxf") throw new Error("DXF_RENDERER_SOURCE_TYPE_MISMATCH");
    const context = await parseDxfFile(input.sourcePath);
    const svg = renderDxfSvg(context, { maxWidth: CAD_OVERVIEW_MAX_WIDTH, maxHeight: CAD_OVERVIEW_MAX_HEIGHT, padding: CAD_OVERVIEW_PADDING });
    const overview = await sharp(Buffer.from(svg.svg)).png({ compressionLevel: 9 }).toBuffer();
    const metadata = await sharp(overview).metadata();
    const width = metadata.width ?? svg.width;
    const height = metadata.height ?? svg.height;
    const plan = planAnalysisTiles(context, ANALYSIS_TILE_OPTIONS);
    const overviewScale = Math.min(
      (CAD_OVERVIEW_MAX_WIDTH - CAD_OVERVIEW_PADDING * 2) / Math.max(1, context.extents.maxX - context.extents.minX),
      (CAD_OVERVIEW_MAX_HEIGHT - CAD_OVERVIEW_PADDING * 2) / Math.max(1, context.extents.maxY - context.extents.minY),
    );
    const tiles: CadDrawingTile[] = await Promise.all(plan.tiles.map(async (tile) => {
      const tileSvg = renderDxfSvg(context, { maxWidth: CAD_ANALYSIS_TILE_PIXELS, maxHeight: CAD_ANALYSIS_TILE_PIXELS, viewport: tile.cadBounds });
      const image = await sharp(Buffer.from(tileSvg.svg)).png({ compressionLevel: 9 }).toBuffer();
      return {
        ...tile,
        imageUrl: dataUrl(image),
        x: CAD_OVERVIEW_PADDING + (tile.cadBounds.minX - context.extents.minX) * overviewScale,
        y: height - CAD_OVERVIEW_PADDING - (tile.cadBounds.maxY - context.extents.minY) * overviewScale,
        width: (tile.cadBounds.maxX - tile.cadBounds.minX) * overviewScale,
        height: (tile.cadBounds.maxY - tile.cadBounds.minY) * overviewScale,
        overlap: Math.max((tile.cadBounds.maxX - tile.cadBounds.minX) * ANALYSIS_TILE_OPTIONS.overlapRatio * overviewScale, (tile.cadBounds.maxY - tile.cadBounds.minY) * ANALYSIS_TILE_OPTIONS.overlapRatio * overviewScale),
      };
    }));

    return {
      overviewImageUrl: dataUrl(overview),
      width,
      height,
      tiles,
      metadata: { layoutCount: 1, units: context.units, context: { ...context, warnings: [...context.warnings, ...plan.warnings] }, coverageLimited: plan.limited },
    };
  },
};
