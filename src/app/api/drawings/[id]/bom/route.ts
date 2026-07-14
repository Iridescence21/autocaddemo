import { NextResponse } from "next/server";
import { OWNER_SCOPE } from "@/lib/domain";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";
import { generateBom } from "@/lib/repositories/components";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const snapshot = await getAnalysisSnapshot((await context.params).id, OWNER_SCOPE);
  return snapshot ? NextResponse.json({ items: snapshot.bomItems }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const bom = await generateBom((await context.params).id, OWNER_SCOPE);
  return bom ? NextResponse.json(bom) : NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
}
