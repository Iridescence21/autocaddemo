import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetTestDatabase, prisma } from "../src/lib/db";
import { createConversation } from "../src/lib/repositories/conversations";
import { createDrawingUpload, getAnalysisSnapshot, listStructuralDrawings } from "../src/lib/repositories/drawings";
import { runDrawingAnalysis } from "../src/lib/analysis/service";
import { getCadRenderer } from "../src/lib/cad/registry";
import { answerDrawingQuestion, type StructuralDrawingRecord } from "../src/lib/chat/drawing-query";
import type { StructuralSnapshot } from "../src/lib/cad/native-bom";

export type DrawingQaSmokeSummary = {
  drawings: Array<{ filename: string; bomRows: number; currentRelayModels: string[]; currentRelayQuantity: number }>;
  answers: { modelCount: string; quantity: string; distribution: string; location: string };
};

export function assertDrawingQaSummary(summary: DrawingQaSmokeSummary) {
  const first = summary.drawings.find((drawing) => drawing.filename === "M-T1-01.dwg");
  const second = summary.drawings.find((drawing) => drawing.filename === "M-T1-02.dwg");
  if (!first || first.currentRelayQuantity !== 4) throw new Error("DRAWING_QA_M_T1_01_QUANTITY");
  if (!second || second.currentRelayQuantity !== 7) throw new Error("DRAWING_QA_M_T1_02_QUANTITY");
  if (first.currentRelayModels.length !== 2 || second.currentRelayModels.length !== 2) throw new Error("DRAWING_QA_CURRENT_RELAY_MODEL_COUNT");
  if (!summary.answers.modelCount.includes("2 种型号")) throw new Error("DRAWING_QA_MODEL_ANSWER");
  if (!summary.answers.quantity.includes("共 4 只")) throw new Error("DRAWING_QA_QUANTITY_ANSWER");
  if (!summary.answers.distribution.includes("M-T1-02.dwg 最多，共 7 只")) throw new Error("DRAWING_QA_DISTRIBUTION_ANSWER");
  if (!summary.answers.location.includes("2 张已分析图纸")) throw new Error("DRAWING_QA_LOCATION_ANSWER");
}

function structuralSnapshot(value: unknown): StructuralSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Partial<StructuralSnapshot>).schemaVersion !== 1) throw new Error("DRAWING_QA_STRUCTURAL_SNAPSHOT_MISSING");
  return value as StructuralSnapshot;
}

export async function inspectDrawingQa(sources: string[]): Promise<DrawingQaSmokeSummary> {
  if (sources.length !== 2) throw new Error("DRAWING_QA_REQUIRES_TWO_SOURCES");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) throw new Error("DRAWING_QA_SQLITE_DATABASE_REQUIRED");
  execFileSync("sqlite3", [resolve(databaseUrl.slice("file:".length)), "PRAGMA user_version=0;"], { stdio: "pipe" });
  execFileSync("npx", ["prisma", "db", "push"], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  await resetTestDatabase();
  const drawingIds = new Map<string, string>();
  for (const source of sources.map((item) => resolve(item)).sort()) {
    const filename = basename(source);
    const conversation = await createConversation({ ownerScope: "demo-user", title: filename });
    const drawing = await createDrawingUpload({ conversationId: conversation.id, ownerScope: "demo-user", originalFilename: filename, safeFilename: filename, storageKey: `smoke/${filename}`, sourceType: "dwg", byteSize: 1 });
    await runDrawingAnalysis(drawing.id, "demo-user", {
      renderer: getCadRenderer("dwg"),
      analyzer: { async analyze() { throw new Error("SMOKE_STRUCTURAL_ONLY"); } },
      analysisMode: "vision",
      sourcePathResolver: () => source,
      delayMs: 0,
    });
    drawingIds.set(filename, drawing.id);
  }

  const records: StructuralDrawingRecord[] = (await listStructuralDrawings("demo-user")).map((drawing) => ({ ...drawing, structuralSnapshot: structuralSnapshot(drawing.structuralSnapshot) }));
  const firstId = drawingIds.get("M-T1-01.dwg");
  const secondId = drawingIds.get("M-T1-02.dwg");
  if (!firstId || !secondId) throw new Error("DRAWING_QA_EXPECTED_FILENAMES");
  const modelCount = answerDrawingQuestion({ question: "电流继电器有几种类型？", currentDrawingId: secondId, drawings: records }).text;
  const quantity = answerDrawingQuestion({ question: "这张图有多少只电流继电器？", currentDrawingId: firstId, drawings: records }).text;
  const distribution = answerDrawingQuestion({ question: "哪张图纸分布的电流继电器多？", currentDrawingId: secondId, drawings: records }).text;
  const location = answerDrawingQuestion({ question: "电流继电器在那个图纸里面？", currentDrawingId: secondId, drawings: records }).text;
  const drawings: DrawingQaSmokeSummary["drawings"] = [];
  for (const filename of ["M-T1-01.dwg", "M-T1-02.dwg"]) {
    const id = drawingIds.get(filename)!;
    const snapshot = await getAnalysisSnapshot(id, "demo-user");
    const structural = structuralSnapshot(snapshot?.drawing.structuralSnapshot);
    const rows = structural.bomRows.filter((row) => row.name === "电流继电器");
    drawings.push({
      filename,
      bomRows: structural.bomRows.length,
      currentRelayModels: [...new Set(rows.map((row) => row.modelSpec).filter((model): model is string => Boolean(model)))].sort(),
      currentRelayQuantity: rows.reduce((sum, row) => sum + (row.quantity ?? row.symbolTags.length), 0),
    });
  }
  const summary = { drawings, answers: { modelCount, quantity, distribution, location } };
  assertDrawingQaSummary(summary);
  return summary;
}

async function main() {
  const summary = await inspectDrawingQa(process.argv.slice(2));
  console.log(JSON.stringify({ passed: true, summary }, null, 2));
}

const directEntry = process.argv[1] ? resolve(process.argv[1]) : "";
if (directEntry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "DRAWING_QA_SMOKE_FAILED");
    process.exitCode = 1;
  }).finally(async () => prisma.$disconnect());
}
