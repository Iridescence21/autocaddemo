import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { DemoAnalysisResult, RenderedCadDrawing } from "@/lib/cad/types";
import { COMPONENT_CATEGORIES } from "@/lib/domain";

const componentSchema = z.object({
  temporaryId: z.string(),
  category: z.enum(COMPONENT_CATEGORIES as [string, ...string[]]),
  tag: z.string().nullable().optional(),
  description: z.string(),
  manufacturer: z.string().nullable().optional(),
  modelNumber: z.string().nullable().optional(),
  specifications: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  tileId: z.string().nullable().optional(),
  location: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }),
  evidence: z.array(z.string()),
  method: z.string(),
  reviewStatus: z.enum(["confirmed", "requires_review", "unknown", "removed"]),
});

const resultSchema = z.object({
  drawingSummary: z.string(),
  components: z.array(componentSchema),
  warnings: z.array(z.string()),
});

export const demoAnalyzer = {
  async analyze(input: { drawingId: string; sourcePath: string; rendered: RenderedCadDrawing }): Promise<DemoAnalysisResult> {
    const marker = (await readFile(input.sourcePath)).toString("utf8").match(/(?:DWG|DXF)-ELECTRICAL-DEMO:([^\s]+)/)?.[1];
    if (marker !== "control-panel-a") throw new Error("DEMO_ANALYSIS_FIXTURE_NOT_FOUND");
    const raw = JSON.parse(await readFile("fixtures/analysis/control-panel-a.json", "utf8"));
    const parsed = resultSchema.parse(raw);
    return {
      drawingSummary: parsed.drawingSummary,
      components: parsed.components.map((component) => ({
        temporaryId: component.temporaryId,
        category: component.category as DemoAnalysisResult["components"][number]["category"],
        tag: component.tag ?? undefined,
        description: component.description,
        manufacturer: component.manufacturer,
        modelNumber: component.modelNumber,
        specifications: component.specifications,
        confidence: component.confidence,
        evidence: component.evidence,
        method: component.method,
        reviewStatus: component.reviewStatus,
        sourceTileId: component.tileId,
        location: component.location,
      })),
      warnings: parsed.warnings,
    };
  },
};
