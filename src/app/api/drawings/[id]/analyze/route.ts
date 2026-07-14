import { NextResponse } from "next/server";
import { describeAnalysisFailure, runDrawingAnalysis } from "@/lib/analysis/service";
import { OWNER_SCOPE } from "@/lib/domain";
import { appendMessage } from "@/lib/repositories/messages";
import { getAnalysisSnapshot, updateAnalysisStatus } from "@/lib/repositories/drawings";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const snapshot = await getAnalysisSnapshot(drawingId, OWNER_SCOPE);
  if (!snapshot?.job) return NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
  if (["converting", "analyzing"].includes(snapshot.job.status)) return NextResponse.json({ jobId: snapshot.job.id, status: snapshot.job.status }, { status: 202 });
  void runDrawingAnalysis(drawingId, OWNER_SCOPE).catch(async (error) => {
    const failure = describeAnalysisFailure(error);
    await updateAnalysisStatus(drawingId, OWNER_SCOPE, { status: "failed", progress: snapshot.job?.progress ?? 0, stage: failure.stage, errorCode: failure.code, errorMessage: failure.userMessage });
    await appendMessage(snapshot.drawing.conversationId, { ownerScope: OWNER_SCOPE, role: "assistant", type: "error", payload: { code: failure.code, message: failure.userMessage } });
    console.error("[analysis] pipeline failed", failure.code);
  });
  return NextResponse.json({ jobId: snapshot.job.id, status: "queued" }, { status: 202 });
}
