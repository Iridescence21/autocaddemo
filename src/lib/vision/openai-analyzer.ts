import { COMPONENT_CATEGORIES } from "@/lib/domain";
import { visionResultSchema, VISION_RESULT_JSON_SCHEMA } from "@/lib/vision/schema";
import type { DrawingVisionAnalyzer, DrawingVisionInput, ValidatedVisionResult } from "@/lib/vision/types";

export type VisionErrorCode = "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "AI_PROVIDER_ERROR" | "AI_RESPONSE_INVALID";

const errorMessages: Record<VisionErrorCode, string> = {
  AI_NOT_CONFIGURED: "尚未配置 AI 分析服务，请添加 OpenAI API 密钥后重试。",
  AI_TIMEOUT: "AI 分析超时，请稍后重试或上传更小的图纸。",
  AI_PROVIDER_ERROR: "AI 分析服务暂时不可用，请稍后重试。",
  AI_RESPONSE_INVALID: "AI 返回的数据格式无效，未保存本次分析结果。",
};

export class VisionAnalysisError extends Error {
  constructor(public readonly code: VisionErrorCode, public readonly userMessage = errorMessages[code], options?: ErrorOptions) {
    super(code, options);
    this.name = "VisionAnalysisError";
  }
}

type OpenAiAnalyzerOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function compactContext(input: DrawingVisionInput) {
  const context = input.rendered.metadata?.context;
  if (!context) return { layers: [], blockNames: [], texts: [], warnings: [] };
  return {
    units: context.units ?? null,
    layers: context.layers.slice(0, 250),
    blockNames: context.blockNames.slice(0, 250),
    texts: context.texts.slice(0, 1000).map((item) => ({ value: item.value, layer: item.layer, handle: item.handle, position: item.position })),
    warnings: context.warnings.slice(0, 100),
  };
}

function promptFor(input: DrawingVisionInput, validationNote?: string) {
  const tiles = input.rendered.tiles.map((tile) => ({ id: tile.id, x: tile.x, y: tile.y, width: tile.width, height: tile.height, overlap: tile.overlap }));
  return [
    "你是电气工程图纸初步识别助手。分析图片中可见的电气元件，并仅从受控类别中选择。",
    "不得猜测图纸中不可见的制造商、型号或规格；缺失值必须为 null 或空数组。",
    "每个 detection 的 location 必须相对于其 tileId 对应图片归一化到 0..1。overview 图片仅用于全局上下文，不作为 tileId。",
    "相邻文字、DXF 图层和块名称只能作为证据，不能当成绝对事实。所有结果均需工程师复核。",
    `允许类别：${COMPONENT_CATEGORIES.join(", ")}`,
    `总览尺寸：${input.rendered.width}×${input.rendered.height}`,
    `瓦片：${JSON.stringify(tiles)}`,
    `DXF 上下文：${JSON.stringify(compactContext(input))}`,
    validationNote ? `上一次输出未通过校验，请修正：${validationNote}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildBody(input: DrawingVisionInput, model: string, validationNote?: string) {
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: promptFor(input, validationNote) },
    { type: "input_text", text: "以下是整张图纸总览：" },
    { type: "input_image", image_url: input.rendered.overviewImageUrl, detail: "high" },
  ];
  for (const tile of input.rendered.tiles) {
    content.push({ type: "input_text", text: `分析瓦片 ${tile.id}，其总览像素范围为 x=${tile.x}, y=${tile.y}, width=${tile.width}, height=${tile.height}。` });
    content.push({ type: "input_image", image_url: tile.imageUrl, detail: "high" });
  }
  return {
    model,
    store: false,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "electrical_drawing_analysis", strict: true, schema: VISION_RESULT_JSON_SCHEMA } },
  };
}

function extractOutputText(payload: unknown) {
  const response = payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  for (const output of response.output ?? []) {
    for (const item of output.content ?? []) {
      if (item.type === "output_text" && typeof item.text === "string") return item.text;
    }
  }
  return null;
}

export function createOpenAiVisionAnalyzer(options: OpenAiAnalyzerOptions = {}): DrawingVisionAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async analyze(input): Promise<ValidatedVisionResult> {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
      if (!apiKey.trim()) throw new VisionAnalysisError("AI_NOT_CONFIGURED");
      const model = options.model ?? process.env.OPENAI_VISION_MODEL ?? "gpt-5.6-terra";
      const baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const timeoutMs = options.timeoutMs ?? Number(process.env.OPENAI_TIMEOUT_MS ?? 120_000);
      let validationNote: string | undefined;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${baseUrl}/responses`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(buildBody(input, model, validationNote)),
            signal: controller.signal,
          });
          if (!response.ok) throw new VisionAnalysisError("AI_PROVIDER_ERROR");
          const outputText = extractOutputText(await response.json());
          if (!outputText) throw new VisionAnalysisError("AI_RESPONSE_INVALID");
          let decoded: unknown;
          try {
            decoded = JSON.parse(outputText);
          } catch {
            validationNote = "输出不是有效 JSON";
            if (attempt === 0) continue;
            throw new VisionAnalysisError("AI_RESPONSE_INVALID");
          }
          const validated = visionResultSchema.safeParse(decoded);
          if (validated.success) return validated.data;
          validationNote = validated.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          if (attempt === 1) throw new VisionAnalysisError("AI_RESPONSE_INVALID");
        } catch (error) {
          if (error instanceof VisionAnalysisError) {
            if (error.code === "AI_RESPONSE_INVALID" && attempt === 0) {
              validationNote = error.code;
              continue;
            }
            throw error;
          }
          if (controller.signal.aborted) throw new VisionAnalysisError("AI_TIMEOUT", undefined, { cause: error });
          throw new VisionAnalysisError("AI_PROVIDER_ERROR", undefined, { cause: error });
        } finally {
          clearTimeout(timer);
        }
      }
      throw new VisionAnalysisError("AI_RESPONSE_INVALID");
    },
  };
}

export const openAiVisionAnalyzer = createOpenAiVisionAnalyzer();
