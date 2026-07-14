import sharp from "sharp";
import { planAnalysisTiles } from "@/lib/cad/analysis-tiles";
import { parseDxfFile } from "@/lib/cad/dxf-parser";
import { renderDxfSvg } from "@/lib/cad/dxf-svg";
import type { CadDrawingTile, CadRenderAdapter } from "@/lib/cad/types";
import type { AnalysisTilePlan } from "@/lib/cad/analysis-tiles";
import type { NormalizedDxfDrawing } from "@/lib/cad/dxf-types";

const CAD_OVERVIEW_MAX_WIDTH = 2048;
const CAD_OVERVIEW_MAX_HEIGHT = 1536;
const CAD_OVERVIEW_PADDING = 48;
const TILE_RENDER_WARNING = "部分分析区域渲染失败，可能未完整扫描。";

export type CadAnalysisTileConfig = {
  tilePixels: number;
  maxTiles: number;
  overlapRatio: number;
  targetEntitiesPerTile: number;
  renderConcurrency: number;
  renderTimeoutMs: number;
};

const DEFAULT_CAD_ANALYSIS_TILE_CONFIG: CadAnalysisTileConfig = {
  tilePixels: 1536,
  maxTiles: 24,
  overlapRatio: 0.1,
  targetEntitiesPerTile: 140,
  renderConcurrency: 4,
  renderTimeoutMs: 15000,
};

function boundedEnvironmentNumber(value: string | undefined, fallback: number, minimum: number, maximum: number, integer = true) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, parsed));
  return integer ? Math.floor(bounded) : bounded;
}

export function readCadAnalysisTileConfig(environment: Record<string, string | undefined> = process.env): CadAnalysisTileConfig {
  return {
    tilePixels: boundedEnvironmentNumber(environment.CAD_ANALYSIS_TILE_PIXELS, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.tilePixels, 256, 4096),
    maxTiles: boundedEnvironmentNumber(environment.CAD_ANALYSIS_MAX_TILES, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.maxTiles, 1, 64),
    overlapRatio: boundedEnvironmentNumber(environment.CAD_ANALYSIS_TILE_OVERLAP_RATIO, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.overlapRatio, 0, 0.5, false),
    targetEntitiesPerTile: boundedEnvironmentNumber(environment.CAD_ANALYSIS_TARGET_ENTITIES_PER_TILE, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.targetEntitiesPerTile, 1, 2000),
    renderConcurrency: boundedEnvironmentNumber(environment.CAD_ANALYSIS_TILE_RENDER_CONCURRENCY, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.renderConcurrency, 1, 8),
    renderTimeoutMs: boundedEnvironmentNumber(environment.CAD_ANALYSIS_TILE_RENDER_TIMEOUT_MS, DEFAULT_CAD_ANALYSIS_TILE_CONFIG.renderTimeoutMs, 100, 60000),
  };
}

function dataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function rasterizeSvg(svg: string) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

type DxfRendererDependencies = {
  environment?: Record<string, string | undefined>;
  rasterizeTile?: (svg: string, tile: AnalysisTilePlan["tiles"][number]) => Promise<Buffer>;
};

function tileCoordinates(tile: AnalysisTilePlan["tiles"][number], drawing: NormalizedDxfDrawing, height: number, overviewScale: number, overlapRatio: number): Omit<CadDrawingTile, "imageUrl"> {
  return {
    ...tile,
    x: CAD_OVERVIEW_PADDING + (tile.cadBounds.minX - drawing.extents.minX) * overviewScale,
    y: height - CAD_OVERVIEW_PADDING - (tile.cadBounds.maxY - drawing.extents.minY) * overviewScale,
    width: (tile.cadBounds.maxX - tile.cadBounds.minX) * overviewScale,
    height: (tile.cadBounds.maxY - tile.cadBounds.minY) * overviewScale,
    overlap: Math.max((tile.cadBounds.maxX - tile.cadBounds.minX) * overlapRatio * overviewScale, (tile.cadBounds.maxY - tile.cadBounds.minY) * overlapRatio * overviewScale),
  };
}

async function renderPlannedTiles(
  plan: AnalysisTilePlan,
  context: NormalizedDxfDrawing,
  height: number,
  overviewScale: number,
  config: CadAnalysisTileConfig,
  rasterizeTile: NonNullable<DxfRendererDependencies["rasterizeTile"]>,
) {
  if (!plan.tiles.length) return { tiles: [], failedTiles: 0 };
  const renderedTiles: Array<CadDrawingTile | undefined> = Array.from({ length: plan.tiles.length });
  let nextTile = 0;
  let completedTiles = 0;
  let activeRasters = 0;
  let failedTiles = 0;

  await new Promise<void>((resolve) => {
    const finishIfComplete = () => {
      if (completedTiles === plan.tiles.length) resolve();
    };
    const startAvailableTiles = () => {
      while (activeRasters < config.renderConcurrency && nextTile < plan.tiles.length) {
        const index = nextTile;
        nextTile += 1;
        activeRasters += 1;
        const tile = plan.tiles[index];
        let outcomeReported = false;
        const reportFailure = () => {
          if (outcomeReported) return;
          outcomeReported = true;
          failedTiles += 1;
          completedTiles += 1;
          finishIfComplete();
        };
        const timeout = setTimeout(reportFailure, config.renderTimeoutMs);
        (async () => {
          const tileSvg = renderDxfSvg(context, { maxWidth: config.tilePixels, maxHeight: config.tilePixels, viewport: tile.cadBounds });
          const image = await rasterizeTile(tileSvg.svg, tile);
          return { ...tileCoordinates(tile, context, height, overviewScale, config.overlapRatio), imageUrl: dataUrl(image) };
        })().then((rendered) => {
          clearTimeout(timeout);
          activeRasters -= 1;
          if (!outcomeReported) {
            outcomeReported = true;
            renderedTiles[index] = rendered;
            completedTiles += 1;
          }
          startAvailableTiles();
          finishIfComplete();
        }).catch(() => {
          clearTimeout(timeout);
          activeRasters -= 1;
          reportFailure();
          startAvailableTiles();
          finishIfComplete();
        });
      }
    };
    startAvailableTiles();
  });

  return { tiles: renderedTiles.filter((tile): tile is CadDrawingTile => Boolean(tile)), failedTiles };
}

export function createDxfRenderer(dependencies: DxfRendererDependencies = {}): CadRenderAdapter {
  const rasterizeTile = dependencies.rasterizeTile ?? rasterizeSvg;
  return {
  async render(input) {
    if (input.sourceType !== "dxf") throw new Error("DXF_RENDERER_SOURCE_TYPE_MISMATCH");
    const context = await parseDxfFile(input.sourcePath);
    const svg = renderDxfSvg(context, { maxWidth: CAD_OVERVIEW_MAX_WIDTH, maxHeight: CAD_OVERVIEW_MAX_HEIGHT, padding: CAD_OVERVIEW_PADDING });
    const overview = await rasterizeSvg(svg.svg);
    const metadata = await sharp(overview).metadata();
    const width = metadata.width ?? svg.width;
    const height = metadata.height ?? svg.height;
    const config = readCadAnalysisTileConfig(dependencies.environment);
    const plan = planAnalysisTiles(context, config);
    const overviewScale = Math.min(
      (CAD_OVERVIEW_MAX_WIDTH - CAD_OVERVIEW_PADDING * 2) / Math.max(1, context.extents.maxX - context.extents.minX),
      (CAD_OVERVIEW_MAX_HEIGHT - CAD_OVERVIEW_PADDING * 2) / Math.max(1, context.extents.maxY - context.extents.minY),
    );
    const { tiles, failedTiles } = await renderPlannedTiles(plan, context, height, overviewScale, config, rasterizeTile);
    if (plan.tiles.length > 0 && tiles.length === 0) throw new Error("DXF_ANALYSIS_TILE_RENDER_FAILED");
    const coverageLimited = plan.limited || failedTiles > 0;
    const warnings = [...context.warnings, ...plan.warnings, ...(failedTiles > 0 ? [TILE_RENDER_WARNING] : [])];

    return {
      overviewImageUrl: dataUrl(overview),
      width,
      height,
      tiles,
      metadata: { layoutCount: 1, units: context.units, context: { ...context, warnings }, coverageLimited },
    };
  },
  };
}

export const dxfRenderer = createDxfRenderer();
