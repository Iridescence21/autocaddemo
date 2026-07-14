import { NextResponse } from "next/server";
import { persistAnalysisFailure, runDrawingAnalysis } from "@/lib/analysis/service";
import { OWNER_SCOPE } from "@/lib/domain";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const snapshot = await getAnalysisSnapshot(drawingId, OWNER_SCOPE);
  if (!snapshot?.job) return NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
  if (["converting", "analyzing"].includes(snapshot.job.status)) return NextResponse.json({ jobId: snapshot.job.id, status: snapshot.job.status }, { status: 202 });
  void runDrawingAnalysis(drawingId, OWNER_SCOPE).catch(async (error) => {
    const failure = await persistAnalysisFailure(drawingId, OWNER_SCOPE, error);
    console.error("[analysis] pipeline failed", failure.code);
  });
  return NextResponse.json({ jobId: snapshot.job.id, status: "queued" }, { status: 202 });
}
