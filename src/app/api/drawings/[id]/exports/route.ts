import { NextResponse } from "next/server";
import { bomToCsv, buildComponentWorkbook } from "@/lib/export";
import { OWNER_SCOPE } from "@/lib/domain";
import { prisma } from "@/lib/db";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";
import { appendMessage } from "@/lib/repositories/messages";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const snapshot = await getAnalysisSnapshot(drawingId, OWNER_SCOPE);
  if (!snapshot) return NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const basename = snapshot.drawing.safeFilename.replace(/\.(dwg|dxf)$/i, "");

  if (format === "csv") {
    const csv = bomToCsv(snapshot.bomItems.map((item) => ({ ...item, specifications: item.specifications })));
    const filename = `${basename}-preliminary-bom.csv`;
    await prisma.drawingExport.create({ data: { drawingId, kind: "bom_csv", status: "completed", filename } });
    await appendMessage(snapshot.drawing.conversationId, { ownerScope: OWNER_SCOPE, role: "assistant", type: "export", payload: { drawingId, filename, url: `/api/drawings/${drawingId}/exports?format=csv` } });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition(filename), "Cache-Control": "no-store" } });
  }

  const workbook = buildComponentWorkbook({
    drawingId,
    filename: snapshot.drawing.originalFilename,
    components: snapshot.components,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${basename}-component-analysis.xlsx`;
  await prisma.drawingExport.create({ data: { drawingId, kind: "component_xlsx", status: "completed", filename } });
  await appendMessage(snapshot.drawing.conversationId, { ownerScope: OWNER_SCOPE, role: "assistant", type: "export", payload: { drawingId, filename, url: `/api/drawings/${drawingId}/exports` } });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}

function contentDisposition(filename: string) {
  return `attachment; filename="drawing-analysis${filename.endsWith(".csv") ? ".csv" : ".xlsx"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
