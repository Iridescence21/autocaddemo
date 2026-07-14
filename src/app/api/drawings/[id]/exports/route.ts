import { NextResponse } from "next/server";
import { bomToCsv } from "@/lib/export";
import { OWNER_SCOPE } from "@/lib/domain";
import { prisma } from "@/lib/db";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";
import { appendMessage } from "@/lib/repositories/messages";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const snapshot = await getAnalysisSnapshot(drawingId, OWNER_SCOPE);
  if (!snapshot) return NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
  const csv = bomToCsv(snapshot.bomItems.map((item) => ({ ...item, specifications: item.specifications })));
  const filename = `${snapshot.drawing.safeFilename.replace(/\.(dwg|dxf)$/i, "")}-preliminary-bom.csv`;
  await prisma.drawingExport.create({ data: { drawingId, kind: "bom_csv", status: "completed", filename } });
  await appendMessage(snapshot.drawing.conversationId, { ownerScope: OWNER_SCOPE, role: "assistant", type: "export", payload: { drawingId, filename, url: `/api/drawings/${drawingId}/exports` } });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
