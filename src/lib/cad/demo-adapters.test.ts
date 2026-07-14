import { describe, expect, it } from "vitest";
import { demoAnalyzer } from "@/lib/cad/demo-analyzer";
import { demoRenderer } from "@/lib/cad/demo-renderer";

describe("demo CAD adapters", () => {
  it("renders a fixture into an overview and overlapping tiles", async () => {
    const rendered = await demoRenderer.render({
      drawingId: "drawing-demo",
      sourcePath: "fixtures/cad/control-panel-a.dwg",
      sourceType: "dwg",
    });
    expect(rendered.tiles.length).toBeGreaterThan(1);
    expect(rendered.tiles.every((tile) => tile.overlap > 0)).toBe(true);
    expect(rendered.overviewImageUrl.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("returns schema-validated controlled components with explicit review evidence", async () => {
    const result = await demoAnalyzer.analyze({
      drawingId: "drawing-demo",
      sourcePath: "fixtures/cad/control-panel-a.dwg",
      rendered: await demoRenderer.render({ drawingId: "drawing-demo", sourcePath: "fixtures/cad/control-panel-a.dwg", sourceType: "dwg" }),
    });
    expect(result.components.map((component) => component.category)).toContain("circuit_breaker");
    expect(result.components.every((component) => component.confidence >= 0 && component.confidence <= 1)).toBe(true);
    expect(result.warnings).toContain("初步 AI 分析结果，需要电气工程师复核。");
    expect(result.components.some((component) => component.reviewStatus !== "confirmed")).toBe(true);
  });
});
