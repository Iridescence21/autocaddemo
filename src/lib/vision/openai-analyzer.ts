import { COMPONENT_CATEGORIES } from "@/lib/domain";
import { getEntityBounds } from "@/lib/cad/analysis-tiles";
import type { CadDrawingTile } from "@/lib/cad/types";
import { visionResultSchema, VISION_RESULT_JSON_SCHEMA } from "@/lib/vision/schema";
import type { DrawingVisionAnalyzer, DrawingVisionInput, ValidatedVisionResult, VisionDetection } from "@/lib/vision/types";

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
  concurrency?: number;
  verificationEntityThreshold?: number;
  fetchImpl?: typeof fetch;
};

type TilePass = "enumerate" | "verify";
type TileVisionResult = Omit<ValidatedVisionResult, "analysisDiagnostics">;

type TileAnalysis = {
  tile: CadDrawingTile;
  enumeration?: TileVisionResult;
  verification?: TileVisionResult;
  verificationAttempted: boolean;
  error?: VisionAnalysisError;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_VERIFICATION_ENTITY_THRESHOLD = 180;

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value!)));
}

function intersects(left: CadDrawingTile["cadBounds"], right: CadDrawingTile["cadBounds"]) {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

function contains(bounds: CadDrawingTile["cadBounds"], position: { x: number; y: number }) {
  return position.x >= bounds.minX && position.x <= bounds.maxX && position.y >= bounds.minY && position.y <= bounds.maxY;
}

function compactContext(input: DrawingVisionInput, tile: CadDrawingTile) {
  const context = input.rendered.metadata?.context;
  if (!context) return { layers: [], blockNames: [], texts: [], warnings: [] };
  const entities = context.entities.filter((entity) => {
    const bounds = getEntityBounds(entity, context);
    return bounds ? intersects(bounds, tile.cadBounds) : false;
  });
  return {
    units: context.units ?? null,
    layers: [...new Set(entities.map((entity) => entity.layer))].slice(0, 250),
    blockNames: [...new Set(entities.flatMap((entity) => entity.type === "INSERT" ? [entity.blockName] : []))].slice(0, 250),
    texts: context.texts.filter((item) => contains(tile.cadBounds, item.position)).slice(0, 1000).map((item) => ({ value: item.value, layer: item.layer, handle: item.handle, position: item.position })),
    warnings: context.warnings.slice(0, 100),
  };
}

function promptFor(input: DrawingVisionInput, tile: CadDrawingTile, pass: TilePass, existing: VisionDetection[], validationNote?: string) {
  const existingCandidates = existing.map((detection) => ({ label: detection.label, category: detection.category, location: detection.location }));
  const passInstruction = pass === "enumerate"
    ? "逐个枚举此区域内每一个可见的独立电气符号实例。重复符号必须分别输出。无法分类的可见符号输出 unknown。不要把多个相邻符号概括为一个“图元簇”。不要在此阶段合并同类项或推算采购数量。"
    : `这是漏检复核。只输出第一遍遗漏的独立符号，或位置明显错误的替代检测；不要重复第一遍已列出的对象。第一遍候选（标签和归一化框）：${JSON.stringify(existingCandidates)}`;
  return [
    "你是电气工程图纸初步识别助手。分析图片中可见的电气元件，并仅从受控类别中选择。",
    "不得猜测图纸中不可见的制造商、型号或规格；缺失值必须为 null 或空数组。",
    "每个 detection 的 location 必须相对于其 tileId 对应图片归一化到 0..1。overview 图片仅用于全局上下文，不作为 tileId。",
    "相邻文字、DXF 图层和块名称只能作为证据，不能当成绝对事实。所有结果均需工程师复核。",
    `允许类别：${COMPONENT_CATEGORIES.join(", ")}`,
    `总览尺寸：${input.rendered.width}×${input.rendered.height}`,
    `当前分析瓦片：${JSON.stringify({ id: tile.id, x: tile.x, y: tile.y, width: tile.width, height: tile.height, overlap: tile.overlap, cadBounds: tile.cadBounds })}`,
    `该瓦片 DXF 上下文：${JSON.stringify(compactContext(input, tile))}`,
    passInstruction,
    validationNote ? `上一次输出未通过校验，请修正：${validationNote}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildTileBody(input: DrawingVisionInput, tile: CadDrawingTile, model: string, pass: TilePass, existing: VisionDetection[], validationNote?: string) {
  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: promptFor(input, tile, pass, existing, validationNote) },
    { type: "input_text", text: "以下是整张图纸总览：" },
    { type: "input_image", image_url: input.rendered.overviewImageUrl, detail: "high" },
    { type: "input_text", text: `分析瓦片 ${tile.id}，其总览像素范围为 x=${tile.x}, y=${tile.y}, width=${tile.width}, height=${tile.height}。` },
    { type: "input_image", image_url: tile.imageUrl, detail: "high" },
  ];
  return {
    model,
    store: false,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "electrical_drawing_analysis", strict: true, schema: VISION_RESULT_JSON_SCHEMA } },
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function normalizeDetections(tile: CadDrawingTile, pass: TilePass, detections: VisionDetection[]) {
  return detections.map((detection, index) => ({ ...detection, temporaryId: `${tile.id}-${pass}-${index + 1}`, tileId: tile.id }));
}

function safeMarkdownPlainText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) => character === "\n" ? character : "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#+\-.!|~=]/g, "\\$&");
}

function sanitizeModelDetection(detection: VisionDetection): VisionDetection {
  return {
    ...detection,
    label: detection.label === null ? null : safeMarkdownPlainText(detection.label),
    description: safeMarkdownPlainText(detection.description),
    manufacturer: detection.manufacturer === null ? null : safeMarkdownPlainText(detection.manufacturer),
    modelNumber: detection.modelNumber === null ? null : safeMarkdownPlainText(detection.modelNumber),
    specifications: detection.specifications.map(safeMarkdownPlainText),
    evidence: detection.evidence.map(safeMarkdownPlainText),
  };
}

function sanitizeModelResult(result: TileVisionResult): TileVisionResult {
  return {
    ...result,
    drawingSummary: safeMarkdownPlainText(result.drawingSummary),
    components: result.components.map(sanitizeModelDetection),
    warnings: result.warnings.map(safeMarkdownPlainText),
  };
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings)];
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
      const timeoutMs = boundedNumber(options.timeoutMs ?? Number(process.env.OPENAI_TIMEOUT_MS), DEFAULT_TIMEOUT_MS, 1, 300_000);
      const concurrency = boundedNumber(options.concurrency ?? Number(process.env.OPENAI_ANALYSIS_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 8);
      const verificationEntityThreshold = boundedNumber(options.verificationEntityThreshold ?? Number(process.env.OPENAI_VERIFY_ENTITY_THRESHOLD), DEFAULT_VERIFICATION_ENTITY_THRESHOLD, 1, 10_000);

      const analyzeTile = async (tile: CadDrawingTile, pass: TilePass, existing: VisionDetection[]) => {
        let validationNote: string | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetchImpl(`${baseUrl}/responses`, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify(buildTileBody(input, tile, model, pass, existing, validationNote)),
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
            if (validated.success) {
              const sanitized = sanitizeModelResult(validated.data);
              return { ...sanitized, components: normalizeDetections(tile, pass, sanitized.components) };
            }
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
      };

      const settled = await mapWithConcurrency(input.rendered.tiles, concurrency, async (tile): Promise<TileAnalysis> => {
        try {
          const enumeration = await analyzeTile(tile, "enumerate", []);
          if (tile.entityCount < verificationEntityThreshold) return { tile, enumeration, verificationAttempted: false };
          try {
            const verification = await analyzeTile(tile, "verify", enumeration.components);
            return { tile, enumeration, verification, verificationAttempted: true };
          } catch (error) {
            return { tile, enumeration, verificationAttempted: true, error: error instanceof VisionAnalysisError ? error : new VisionAnalysisError("AI_PROVIDER_ERROR", undefined, { cause: error }) };
          }
        } catch (error) {
          return { tile, verificationAttempted: false, error: error instanceof VisionAnalysisError ? error : new VisionAnalysisError("AI_PROVIDER_ERROR", undefined, { cause: error }) };
        }
      });

      const completed = settled.filter((item) => item.enumeration);
      if (!completed.length) throw new VisionAnalysisError("AI_PROVIDER_ERROR");
      const components = completed.flatMap((item) => [...(item.enumeration?.components ?? []), ...(item.verification?.components ?? [])]);
      const modelWarnings = completed.flatMap((item) => [...(item.enumeration?.warnings ?? []), ...(item.verification?.warnings ?? [])]);
      const tileWarnings = settled.flatMap((item) => {
        if (!item.error) return [];
        return item.enumeration
          ? [`区域 ${item.tile.id} 的漏检复核未完成，已保留第一遍枚举结果。`]
          : [`区域 ${item.tile.id} 分析失败，已保留其他区域结果。`];
      });
      const contextWarnings = input.rendered.metadata?.context?.warnings ?? [];
      const coverageWarning = input.rendered.metadata?.coverageLimited ? ["图纸分析区域覆盖受限，结果可能不完整。"] : [];
      return {
        drawingSummary: completed[0].enumeration!.drawingSummary,
        components,
        warnings: uniqueWarnings([...modelWarnings, ...contextWarnings, ...coverageWarning, ...tileWarnings]),
        analysisDiagnostics: {
          attemptedTiles: input.rendered.tiles.length,
          completedTiles: completed.length,
          failedTiles: settled.filter((item) => !item.enumeration).length,
          verificationTiles: settled.filter((item) => item.verificationAttempted).length,
          rawDetectionCount: components.length,
          coverageLimited: Boolean(input.rendered.metadata?.coverageLimited),
        },
      };
    },
  };
}

export const openAiVisionAnalyzer = createOpenAiVisionAnalyzer();
