import sharp from "sharp";
import { parseDxfFile } from "@/lib/cad/dxf-parser";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import type { CadDrawingTile, CadRenderAdapter } from "@/lib/cad/types";

function dataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export const dxfRenderer: CadRenderAdapter = {
  async render(input) {
    if (input.sourceType !== "dxf") throw new Error("DXF_RENDERER_SOURCE_TYPE_MISMATCH");
    const context = await parseDxfFile(input.sourcePath);
    const svg = renderDxfSvg(context);
    const overview = await sharp(Buffer.from(svg.svg)).png({ compressionLevel: 9 }).toBuffer();
    const metadata = await sharp(overview).metadata();
    const width = metadata.width ?? svg.width;
    const height = metadata.height ?? svg.height;
    const overlap = 96;
    const tiles: CadDrawingTile[] = [];

    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        const baseLeft = Math.floor(column * width / 2);
        const baseTop = Math.floor(row * height / 2);
        const baseRight = column === 1 ? width : Math.ceil((column + 1) * width / 2);
        const baseBottom = row === 1 ? height : Math.ceil((row + 1) * height / 2);
        const left = Math.max(0, baseLeft - (column === 1 ? overlap : 0));
        const top = Math.max(0, baseTop - (row === 1 ? overlap : 0));
        const right = Math.min(width, baseRight + (column === 0 ? overlap : 0));
        const bottom = Math.min(height, baseBottom + (row === 0 ? overlap : 0));
        const tileWidth = Math.max(1, right - left);
        const tileHeight = Math.max(1, bottom - top);
        const buffer = await sharp(overview).extract({ left, top, width: tileWidth, height: tileHeight }).png({ compressionLevel: 9 }).toBuffer();
        tiles.push({ id: `tile-${row + 1}-${column + 1}`, imageUrl: dataUrl(buffer), x: left, y: top, width: tileWidth, height: tileHeight, overlap });
      }
    }

    return {
      overviewImageUrl: dataUrl(overview),
      width,
      height,
      tiles,
      metadata: { layoutCount: 1, units: context.units, context },
    };
  },
};
