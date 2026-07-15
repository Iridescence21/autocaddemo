import { NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_SCOPE } from "@/lib/domain";
import { getConversation } from "@/lib/repositories/conversations";
import { listStructuralDrawings } from "@/lib/repositories/drawings";
import { appendMessage } from "@/lib/repositories/messages";
import { answerDrawingQuestion, type StructuralDrawingRecord } from "@/lib/chat/drawing-query";
import type { StructuralSnapshot } from "@/lib/cad/native-bom";

export const runtime = "nodejs";

const requestSchema = z.object({ question: z.string().trim().min(1).max(1000) });

function parseStructuralSnapshot(value: unknown): StructuralSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StructuralSnapshot>;
  if (candidate.schemaVersion !== 1 || !candidate.counts || !Array.isArray(candidate.tags) || !Array.isArray(candidate.bomRows) || !Array.isArray(candidate.reviewIssues)) return null;
  return candidate as StructuralSnapshot;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_QUESTION", message: "请输入有效的图纸问题。" }, { status: 400 });
  const conversationId = (await context.params).id;
  const conversation = await getConversation(conversationId, OWNER_SCOPE);
  const currentSnapshot = parseStructuralSnapshot(conversation?.drawing?.structuralSnapshot);
  if (!conversation?.drawing || !currentSnapshot) {
    return NextResponse.json({ code: "ANALYSIS_REQUIRED", message: "请先上传图纸并完成 CAD 结构分析。" }, { status: 409 });
  }

  const drawings: StructuralDrawingRecord[] = (await listStructuralDrawings(OWNER_SCOPE)).flatMap((drawing) => {
    const structuralSnapshot = parseStructuralSnapshot(drawing.structuralSnapshot);
    return structuralSnapshot ? [{ ...drawing, structuralSnapshot }] : [];
  });
  const answer = answerDrawingQuestion({ question: parsed.data.question, currentDrawingId: conversation.drawing.id, drawings });
  await appendMessage(conversationId, {
    ownerScope: OWNER_SCOPE,
    role: "assistant",
    type: "text",
    payload: { text: answer.text, evidence: answer.evidence, intent: answer.intent, entityName: answer.entityName, drawingIds: answer.drawingIds },
  });
  return NextResponse.json({ answer });
}
