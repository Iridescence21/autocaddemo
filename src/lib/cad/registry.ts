import type { CadRenderAdapter, CadSourceType } from "@/lib/cad/types";
import { demoRenderer } from "@/lib/cad/demo-renderer";
import { dwgRenderer } from "@/lib/cad/dwg-renderer";
import { dxfRenderer } from "@/lib/cad/dxf-renderer";

export function getCadRenderer(sourceType: CadSourceType): CadRenderAdapter {
  if (sourceType === "dxf") return dxfRenderer;
  if (sourceType === "dwg") return dwgRenderer;
  if ((process.env.CAD_RENDERER ?? "demo") === "demo") return demoRenderer;
  throw new Error("DWG_RENDERER_NOT_CONFIGURED");
}
