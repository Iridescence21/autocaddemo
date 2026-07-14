import { NextResponse } from "next/server";
import { z } from "zod";
import { COMPONENT_CATEGORIES, OWNER_SCOPE, type ComponentCategory } from "@/lib/domain";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";
import { removeComponent, updateComponent } from "@/lib/repositories/components";

export const runtime = "nodejs";
const patchSchema = z.object({ category: z.enum(COMPONENT_CATEGORIES as [ComponentCategory, ...ComponentCategory[]]).optional(), tag: z.string().max(40).optional(), description: z.string().max(200).optional(), reviewStatus: z.enum(["confirmed", "requires_review", "unknown"]).optional() });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const snapshot = await getAnalysisSnapshot((await context.params).id, OWNER_SCOPE);
  return snapshot ? NextResponse.json({ components: snapshot.components }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const body = patchSchema.extend({ componentId: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ code: "INVALID_COMPONENT", message: "元件修改内容无效。" }, { status: 400 });
  const { componentId, ...data } = body.data;
  const component = await updateComponent(drawingId, componentId, OWNER_SCOPE, data);
  return component ? NextResponse.json({ component }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到元件。" }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const drawingId = (await context.params).id;
  const body = z.object({ componentId: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ code: "INVALID_COMPONENT", message: "元件 ID 无效。" }, { status: 400 });
  const removed = await removeComponent(drawingId, body.data.componentId, OWNER_SCOPE);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到元件。" }, { status: 404 });
}
