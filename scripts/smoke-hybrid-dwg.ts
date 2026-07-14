import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStructuralEvidence } from "../src/lib/cad/structural-evidence";
import { createLibreDwgConverter } from "../src/lib/cad/dwg-converter";
import { createDwgRenderer } from "../src/lib/cad/dwg-renderer";

export type HybridSmokeSummary = {
  source: string;
  overview: { width: number; height: number };
  counts: { entities: number; texts: number; blocks: number; layers: number };
  tiles: { count: number; coverageLimited: boolean };
  structural: { count: number; tags: string[] };
};

export function assertHybridSmokeSummary(summary: HybridSmokeSummary, requiredTags: string[] = []) {
  if (summary.counts.entities <= 0 || summary.counts.texts <= 0) throw new Error("HYBRID_SMOKE_EMPTY_ENTITIES");
  if (summary.overview.width <= 0 || summary.overview.height <= 0) throw new Error("HYBRID_SMOKE_EMPTY_IMAGE");
  if (summary.tiles.count <= 0) throw new Error("HYBRID_SMOKE_EMPTY_TILES");
  const missing = requiredTags.filter((tag) => !summary.structural.tags.includes(tag));
  if (missing.length) throw new Error(`HYBRID_SMOKE_REQUIRED_TAG_MISSING:${missing.join(",")}`);
}

export async function inspectHybridDwg(sourcePath: string): Promise<HybridSmokeSummary> {
  const converter = createLibreDwgConverter({ executable: process.env.DWG_CONVERTER ?? "dwg2dxf" });
  const renderer = createDwgRenderer(converter);
  const rendered = await renderer.render({ drawingId: basename(sourcePath), sourcePath, sourceType: "dwg" });
  const context = rendered.metadata?.context;
  if (!context) throw new Error("HYBRID_SMOKE_CONTEXT_MISSING");
  const structural = buildStructuralEvidence(context, rendered);
  const summary: HybridSmokeSummary = {
    source: basename(sourcePath),
    overview: { width: rendered.width, height: rendered.height },
    counts: {
      entities: context.entities.length,
      texts: context.texts.length,
      blocks: context.blockNames.length,
      layers: context.layers.length,
    },
    tiles: { count: rendered.tiles.length, coverageLimited: Boolean(rendered.metadata?.coverageLimited) },
    structural: { count: structural.length, tags: [...new Set(structural.map((item) => item.tag))].sort() },
  };
  const requiredTags = summary.source.startsWith("M-T1-02") ? ["TA1", "KA1", "YCT1"] : [];
  assertHybridSmokeSummary(summary, requiredTags);
  return summary;
}

async function main() {
  const sources = process.argv.slice(2);
  if (!sources.length) throw new Error("HYBRID_SMOKE_SOURCE_REQUIRED");
  const summaries = [];
  for (const source of sources) summaries.push(await inspectHybridDwg(resolve(source)));
  console.log(JSON.stringify({ passed: true, summaries }, null, 2));
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : "";
if (directEntry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "HYBRID_SMOKE_FAILED");
    process.exitCode = 1;
  });
}
