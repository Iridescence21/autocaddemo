import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { dxfRenderer } from "../src/lib/cad/dxf-renderer";
import { createOpenAiVisionAnalyzer } from "../src/lib/vision/openai-analyzer";
import { consolidateVisionComponents } from "../src/lib/vision/consolidate";

async function main() {
  loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY is not configured. Add it to .env.local before running the live DXF smoke test.");
    process.exitCode = 2;
    return;
  }

  const sourcePath = resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf");
  const rendered = await dxfRenderer.render({ drawingId: "live-smoke-dxf", sourcePath, sourceType: "dxf" });
  const analyzer = createOpenAiVisionAnalyzer();
  const result = await analyzer.analyze({ drawingId: "live-smoke-dxf", sourcePath, rendered });
  const components = consolidateVisionComponents(result, rendered);
  const counts = components.reduce<Record<string, number>>((current, component) => {
    current[component.category] = (current[component.category] ?? 0) + 1;
    return current;
  }, {});
  console.log(JSON.stringify({ summary: result.drawingSummary, componentCount: components.length, categories: counts, warningCount: result.warnings.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "DXF smoke test failed");
  process.exitCode = 1;
});
