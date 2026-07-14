import { NextResponse } from "next/server";
import { OWNER_SCOPE } from "@/lib/domain";
import { getAnalysisSnapshot } from "@/lib/repositories/drawings";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const snapshot = await getAnalysisSnapshot((await context.params).id, OWNER_SCOPE);
  return snapshot ? NextResponse.json({ snapshot }) : NextResponse.json({ code: "NOT_FOUND", message: "未找到图纸。" }, { status: 404 });
}
