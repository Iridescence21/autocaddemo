import { NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_SCOPE } from "@/lib/domain";
import { createDrawingUpload } from "@/lib/repositories/drawings";
import { appendMessage } from "@/lib/repositories/messages";
import { storeCadUpload } from "@/lib/uploads/storage";
import { validateCadUpload } from "@/lib/uploads/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const conversationId = z.string().min(1).safeParse(form.get("conversationId"));
  const file = form.get("file");
  if (!conversationId.success || !(file instanceof File)) return NextResponse.json({ code: "INVALID_UPLOAD", message: "请选择一份 DWG 或 DXF 图纸。" }, { status: 400 });
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const validated = validateCadUpload({ name: file.name, type: file.type, size: file.size, bytes });
    const drawingId = crypto.randomUUID();
    const stored = await storeCadUpload({ drawingId, ownerScope: OWNER_SCOPE, safeFilename: validated.safeFilename, bytes });
    const drawing = await createDrawingUpload({ conversationId: conversationId.data, ownerScope: OWNER_SCOPE, originalFilename: validated.name, safeFilename: validated.safeFilename, storageKey: stored.storageKey, sourceType: validated.sourceType, byteSize: validated.size });
    await appendMessage(conversationId.data, { ownerScope: OWNER_SCOPE, role: "user", type: "file", payload: { drawingId: drawing.id, filename: validated.name, sourceType: validated.sourceType, byteSize: validated.size, status: "accepted" } });
    await appendMessage(conversationId.data, { ownerScope: OWNER_SCOPE, role: "assistant", type: "text", payload: { text: `已收到 ${validated.name}。我会准备图纸、划分分析区域，并生成按类别整理的初步元件清单。` } });
    return NextResponse.json({ drawingId: drawing.id, jobId: drawing.analysisJob?.id, filename: validated.name, sourceType: validated.sourceType }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error && /^([A-Z_]+)$/.test(error.message) ? error.message : "UPLOAD_FAILED";
    const messages: Record<string, string> = { UNSUPPORTED_FILE_TYPE: "仅支持 DWG 和 DXF 文件。", INVALID_CAD_SIGNATURE: "文件内容不像有效的 DWG 或 DXF 图纸。", FILE_TOO_LARGE: "图纸超过当前文件大小限制。", INVALID_UPLOAD: "上传内容无效。", UPLOAD_FAILED: "无法安全保存图纸。" };
    return NextResponse.json({ code, message: messages[code] ?? messages.UPLOAD_FAILED }, { status: 400 });
  }
}
