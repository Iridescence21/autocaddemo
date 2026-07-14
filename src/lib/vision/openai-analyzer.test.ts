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

function resultFor(tileId: string, labels: string[]) {
  return {
  drawingSummary: "可能为电气控制原理图",
    components: labels.map((label, index) => ({
      temporaryId: `detection-${index + 1}`,
      category: "contactor" as const,
      label,
      description: "可能为接触器",
      manufacturer: null as string | null,
      modelNumber: null as string | null,
      specifications: ["24VDC"],
      confidence: 0.78,
      tileId,
      location: { x: 0.4, y: 0.3, width: 0.1, height: 0.08 },
      evidence: [`附近文字 ${label}`],
      reviewRequired: true,
    })),
  warnings: ["初步 AI 分析，需要工程师复核"],
  };
}

const validResult = resultFor("tile-1-1", ["KM1"]);

function inputWithTiles(count: number, entityCount = 1) {
  const tiles = Array.from({ length: count }, (_, index) => ({
    id: `tile-${index + 1}`,
    imageUrl: "data:image/png;base64,dGlsZQ==",
    x: index * 600,
    y: 0,
    width: 600,
    height: 496,
    overlap: 0,
    cadBounds: { minX: index * 100, minY: 0, maxX: (index + 1) * 100, maxY: 80 },
    entityCount,
    textCount: 1,
    blockCount: 0,
  }));
  return {
    drawingId: "drawing-1",
    sourcePath: "/private/drawing.dxf",
    rendered: {
      ...rendered,
      tiles,
      metadata: {
        ...rendered.metadata,
        context: {
          ...rendered.metadata!.context!,
          texts: tiles.map((tile, index) => ({ value: `T${index + 1}`, layer: "SYMBOL", handle: String(index + 1), position: { x: tile.cadBounds.minX + 10, y: 20 } })),
        },
      },
    },
  };
}

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

  it("enumerates each tile in a separate region-scoped request", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelResponse(resultFor("wrong-tile", ["QF1", "QF2"])))
      .mockResolvedValueOnce(modelResponse(resultFor("wrong-tile", ["KM1"])));
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl, verificationEntityThreshold: 9999 });

    const result = await analyzer.analyze(inputWithTiles(2));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.components.map((item) => item.label)).toEqual(["QF1", "QF2", "KM1"]);
    expect(result.components.map((item) => item.temporaryId)).toEqual(["tile-1-enumerate-1", "tile-1-enumerate-2", "tile-2-enumerate-1"]);
    expect(result.components.map((item) => item.tileId)).toEqual(["tile-1", "tile-1", "tile-2"]);
    expect(result.analysisDiagnostics.completedTiles).toBe(2);
    expect(JSON.stringify(fetchImpl.mock.calls[0][1]?.body)).toContain("T1");
    expect(JSON.stringify(fetchImpl.mock.calls[0][1]?.body)).not.toContain("T2");
  });

  it("converts model-authored strings to safe Markdown plain text without changing application warnings", async () => {
    const malicious = resultFor("tile-1-1", ["[点击](javascript:alert(1))"]);
    malicious.drawingSummary = "<img src=x onerror=alert(1)>\n# 中文标题";
    malicious.warnings = ["# model warning"];
    malicious.components[0] = {
      ...malicious.components[0],
      description: "<img src=x onerror=alert(1)>\n# heading\n| table |\n```code```",
      manufacturer: "<b>制造商</b>",
      modelNumber: "`型号`",
      specifications: ["| 规格 |", "保留中文\n下一行\u0000"],
      evidence: ["![图片](javascript:alert(1))"],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(modelResponse(malicious));
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl });
    const input = inputWithTiles(1);
    input.rendered.metadata!.context!.warnings = ["<application warning>"];

    const result = await analyzer.analyze(input);
    const detection = result.components[0];

    expect(result.drawingSummary).toBe("&lt;img src\\=x onerror\\=alert\\(1\\)&gt;\n\\# 中文标题");
    expect(result.warnings).toEqual(expect.arrayContaining(["\\# model warning", "<application warning>"]));
    expect(detection.label).toBe("\\[点击\\]\\(javascript:alert\\(1\\)\\)");
    expect(detection.description).toContain("&lt;img src\\=x onerror\\=alert\\(1\\)&gt;");
    expect(detection.description).toContain("\\# heading");
    expect(detection.description).toContain("\\| table \\|");
    expect(detection.description).toContain("\\`\\`\\`code\\`\\`\\`");
    expect(detection.manufacturer).toBe("&lt;b&gt;制造商&lt;/b&gt;");
    expect(detection.modelNumber).toBe("\\`型号\\`");
    expect(detection.specifications).toEqual(["\\| 规格 \\|", "保留中文\n下一行"]);
    expect(detection.evidence).toEqual(["\\!\\[图片\\]\\(javascript:alert\\(1\\)\\)"]);
    expect(JSON.stringify(result.components)).not.toContain("<img");
    expect(JSON.stringify(result.components)).not.toContain("](javascript:");
  });

  it("runs a missed-candidate verification pass for dense tiles", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF1"])))
      .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF2"])));
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl, verificationEntityThreshold: 100 });

    const result = await analyzer.analyze(inputWithTiles(1, 300));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetchImpl.mock.calls[1][1]?.body)).toContain("QF1");
    expect(result.analysisDiagnostics.verificationTiles).toBe(1);
    expect(result.components.map((item) => item.label)).toEqual(["QF1", "QF2"]);
  });

  it("preserves successful tiles after a tile failure but reports a provider error when all tiles fail", async () => {
    const partialFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(modelResponse(resultFor("tile-1", ["QF1"])))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const partialAnalyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl: partialFetch, verificationEntityThreshold: 9999 });

    const partial = await partialAnalyzer.analyze(inputWithTiles(2));

    expect(partial.components.map((item) => item.label)).toEqual(["QF1"]);
    expect(partial.analysisDiagnostics).toMatchObject({ attemptedTiles: 2, completedTiles: 1, failedTiles: 1 });
    expect(partial.warnings.join("\n")).toContain("tile-2");

    const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const failedAnalyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl: failedFetch, verificationEntityThreshold: 9999 });
    await expect(failedAnalyzer.analyze(inputWithTiles(2))).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });

  it("retries one invalid model response and reports a provider error when every tile fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => modelResponse({ drawingSummary: "invalid", components: [{ category: "invented" }], warnings: [] }));
    const analyzer = createOpenAiVisionAnalyzer({ apiKey: "test-secret", fetchImpl });

    await expect(analyzer.analyze({ drawingId: "drawing-1", sourcePath: "/private/drawing.dxf", rendered }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
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
