import { readFile } from "node:fs/promises";
import type { CadRenderAdapter } from "@/lib/cad/types";

function svgDataUrl(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="#f7f9fc"/><path d="M40 40H1160V680H40Z M120 160H480V300H120Z M620 160H1080V300H620Z M120 420H1080V560H120Z" fill="none" stroke="#9ab0c9" stroke-width="4"/><path d="M160 230H440 M660 230H1040 M240 490H960" stroke="#2f6fad" stroke-width="6"/><circle cx="300" cy="230" r="24" fill="none" stroke="#b34c35" stroke-width="5"/><text x="60" y="105" font-family="Arial" font-size="28" fill="#384b63">${label}</text><text x="90" y="635" font-family="Arial" font-size="18" fill="#6a7787">演示预览 · 标记位置为近似值 · 需要工程师复核</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const demoRenderer: CadRenderAdapter = {
  async render(input) {
    const content = (await readFile(input.sourcePath)).subarray(0, 2048).toString("utf8");
    if (!content.includes("DWG-ELECTRICAL-DEMO:") && !content.includes("DXF-ELECTRICAL-DEMO:")) throw new Error("DEMO_FIXTURE_NOT_FOUND");
    return {
      overviewImageUrl: svgDataUrl(input.sourceType.toUpperCase() + " electrical drawing"),
      width: 1200,
      height: 720,
      tiles: [
        { id: "tile-1", imageUrl: svgDataUrl("Tile 1"), x: 0, y: 0, width: 600, height: 400, overlap: 48, cadBounds: { minX: 0, minY: 320, maxX: 600, maxY: 720 }, entityCount: 1, textCount: 0, blockCount: 0 },
        { id: "tile-2", imageUrl: svgDataUrl("Tile 2"), x: 552, y: 0, width: 648, height: 400, overlap: 48, cadBounds: { minX: 552, minY: 320, maxX: 1200, maxY: 720 }, entityCount: 1, textCount: 0, blockCount: 0 },
        { id: "tile-3", imageUrl: svgDataUrl("Tile 3"), x: 0, y: 352, width: 600, height: 368, overlap: 48, cadBounds: { minX: 0, minY: 0, maxX: 600, maxY: 368 }, entityCount: 1, textCount: 0, blockCount: 0 },
        { id: "tile-4", imageUrl: svgDataUrl("Tile 4"), x: 552, y: 352, width: 648, height: 368, overlap: 48, cadBounds: { minX: 552, minY: 0, maxX: 1200, maxY: 368 }, entityCount: 1, textCount: 0, blockCount: 0 },
      ],
      metadata: { layoutCount: 2, units: "millimeters" },
    };
  },
};
