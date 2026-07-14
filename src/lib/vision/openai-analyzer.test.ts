import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiVisionAnalyzer, VisionAnalysisError } from "@/lib/vision/openai-analyzer";
import type { RenderedCadDrawing } from "@/lib/cad/types";

const rendered: RenderedCadDrawing = {
  overviewImageUrl: "data:image/png;base64,b3ZlcnZpZXc=",
  width: 1200,
  height: 800,
  tiles: [
    { id: "tile-1-1", imageUrl: "data:image/png;base64,dGlsZQ==", x: 0, y: 0, width: 696, height: 496, overlap: 96, cadBounds: { minX: 0, minY: 0, maxX: 100, maxY: 80 }, entityCount: 1, textCount: 0, blockCount: 0 },
  ],
  metadata: {
    layoutCount: 1,
    units: "millimeters",
    context: {
      entities: [],
      blockDefinitions: {},
      layers: ["WIRE", "SYMBOL"],
      blockNames: ["CONTACTOR_COIL"],
      texts: [{ value: "KM1", layer: "SYMBOL", handle: "22", position: { x: 45, y: 62 } }],
      extents: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
      units: "millimeters",
      warnings: [],
    },
  },
};

const validResult = {
  drawingSummary: "可能为电气控制原理图",
  components: [{
    temporaryId: "detection-001",
    category: "contactor",
    label: "KM1",
    description: "可能为接触器",
    manufacturer: null,
    modelNumber: null,
    specifications: ["24VDC"],
    confidence: 0.78,
    tileId: "tile-1-1",
    location: { x: 0.4, y: 0.3, width: 0.1, height: 0.08 },
    evidence: ["附近文字 KM1"],
    reviewRequired: true,
  }],
  warnings: ["初步 AI 分析，需要工程师复核"],
};

function modelResponse(result: unknown) {
  return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: typeof result === "string" ? result : JSON.stringify(result) }] }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("OpenAI drawing vision analyzer", () => {
  it("sends images and extracted DXF context through a strict Responses request", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return modelResponse(validResult);
    };
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl });
    const result = await analyzer.analyze({ drawingId: "drawing-1", sourcePath: "/private/drawing.dxf", rendered });

    expect(result.components[0].category).toBe("contactor");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
    expect(requests[0].authorization).toBe("Bearer test-secret");
    expect(requests[0].body.model).toBe("gpt-5.6-terra");
    expect(requests[0].body.store).toBe(false);
    expect(JSON.stringify(requests[0].body)).toContain("input_image");
    expect(JSON.stringify(requests[0].body)).toContain("KM1");
    expect(JSON.stringify(requests[0].body)).toContain("circuit_breaker");
    expect((requests[0].body.text as { format: { type: string } }).format.type).toBe("json_schema");
  });

  it("retries one invalid model response and then reports a stable schema error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => modelResponse({ drawingSummary: "invalid", components: [{ category: "invented" }], warnings: [] }));
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl });

    await expect(analyzer.analyze({ drawingId: "drawing-1", sourcePath: "/private/drawing.dxf", rendered }))
      .rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails before network access when the server key is absent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "", fetchImpl });

    await expect(analyzer.analyze({ drawingId: "drawing-1", sourcePath: "/private/drawing.dxf", rendered }))
      .rejects.toEqual(expect.objectContaining<Partial<VisionAnalysisError>>({ code: "AI_NOT_CONFIGURED", userMessage: "尚未配置 AI 分析服务，请添加 OpenAI API 密钥后重试。" }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
