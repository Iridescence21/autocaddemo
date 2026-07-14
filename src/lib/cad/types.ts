import type { ComponentInput } from "@/lib/domain";
import type { NormalizedDxfDrawing } from "@/lib/cad/dxf-types";

export type CadSourceType = "dwg" | "dxf";

export type CadDrawingTile = {
  id: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  overlap: number;
};

export type RenderedCadDrawing = {
  overviewImageUrl: string;
  width: number;
  height: number;
  tiles: CadDrawingTile[];
  metadata?: { layoutCount?: number; units?: string; context?: NormalizedDxfDrawing };
};

export interface CadRenderAdapter {
  render(input: { drawingId: string; sourcePath: string; sourceType: CadSourceType }): Promise<RenderedCadDrawing>;
}

export type DemoAnalysisResult = {
  drawingSummary: string;
  components: ComponentInput[];
  warnings: string[];
};
