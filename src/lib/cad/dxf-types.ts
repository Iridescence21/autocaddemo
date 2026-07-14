export type DxfPoint = { x: number; y: number };

type DxfEntityBase = {
  type: string;
  layer: string;
  handle: string | null;
};

export type NormalizedDxfEntity =
  | (DxfEntityBase & { type: "LINE" | "LWPOLYLINE" | "POLYLINE"; points: DxfPoint[]; closed: boolean })
  | (DxfEntityBase & { type: "CIRCLE"; center: DxfPoint; radius: number })
  | (DxfEntityBase & { type: "ARC"; center: DxfPoint; radius: number; startAngle: number; endAngle: number })
  | (DxfEntityBase & { type: "ELLIPSE"; center: DxfPoint; majorAxis: DxfPoint; axisRatio: number; startAngle: number; endAngle: number })
  | (DxfEntityBase & { type: "TEXT" | "MTEXT"; position: DxfPoint; value: string; height: number; rotation: number })
  | (DxfEntityBase & { type: "INSERT"; blockName: string; position: DxfPoint; scaleX: number; scaleY: number; rotation: number });

export type DxfTextContext = {
  value: string;
  layer: string;
  handle: string | null;
  position: DxfPoint;
};

export type DxfExtents = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type NormalizedDxfDrawing = {
  entities: NormalizedDxfEntity[];
  blockDefinitions: Record<string, NormalizedDxfEntity[]>;
  layers: string[];
  blockNames: string[];
  texts: DxfTextContext[];
  extents: DxfExtents;
  units?: string;
  warnings: string[];
};
