import type { RenderedCadDrawing } from "@/lib/cad/types";
import type { ComponentCategory } from "@/lib/domain";

export type VisionLocation = { x: number; y: number; width: number; height: number };

export type VisionDetection = {
  temporaryId: string;
  category: ComponentCategory;
  label: string | null;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: string[];
  confidence: number;
  tileId: string;
  location: VisionLocation;
  evidence: string[];
  reviewRequired: boolean;
};

export type ValidatedVisionResult = {
  drawingSummary: string;
  components: VisionDetection[];
  warnings: string[];
};

export type DrawingVisionInput = {
  drawingId: string;
  sourcePath: string;
  rendered: RenderedCadDrawing;
};

export interface DrawingVisionAnalyzer {
  analyze(input: DrawingVisionInput): Promise<ValidatedVisionResult>;
}
