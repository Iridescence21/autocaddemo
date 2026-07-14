export const OWNER_SCOPE = "demo-user";

export const CONVERSATION_STATUSES = [
  "empty",
  "uploading",
  "queued",
  "converting",
  "analyzing",
  "requires_review",
  "completed",
  "failed",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export type ComponentCategory =
  | "circuit_breaker"
  | "fuse"
  | "contactor"
  | "relay"
  | "terminal_block"
  | "transformer"
  | "power_supply"
  | "plc"
  | "motor"
  | "variable_frequency_drive"
  | "sensor"
  | "switch"
  | "push_button"
  | "emergency_stop"
  | "indicator_light"
  | "connector"
  | "ground"
  | "unknown";

export const COMPONENT_CATEGORIES: ComponentCategory[] = [
  "circuit_breaker", "fuse", "contactor", "relay", "terminal_block", "transformer",
  "power_supply", "plc", "motor", "variable_frequency_drive", "sensor", "switch",
  "push_button", "emergency_stop", "indicator_light", "connector", "ground", "unknown",
];

export type ReviewStatus = "confirmed" | "requires_review" | "unknown" | "removed";

export type DrawingChatMessage =
  | { type: "text"; text: string }
  | { type: "file"; drawingId: string; filename: string; sourceType: "dwg" | "dxf"; byteSize: number; status: string }
  | { type: "analysis_progress"; jobId: string; stage: string; progress: number; status: string }
  | { type: "drawing_summary"; drawingId: string; summary: string; warnings: string[] }
  | { type: "component_results"; drawingId: string; total: number; confirmed: number; requiresReview: number; unknown: number }
  | { type: "bom_results"; drawingId: string; itemCount: number; totalQuantity: number }
  | { type: "review_request"; drawingId: string; componentIds: string[] }
  | { type: "export"; drawingId: string; filename: string; url: string }
  | { type: "error"; code: string; message: string };

export type ComponentInput = {
  temporaryId: string;
  category: ComponentCategory;
  tag?: string;
  description: string;
  specifications: string[];
  manufacturer?: string | null;
  modelNumber?: string | null;
  confidence: number;
  evidence: string[];
  method: string;
  reviewStatus: ReviewStatus;
  sourceTileId?: string | null;
  location?: { x: number; y: number; width: number; height: number };
};

export type PhysicalDeviceInput = {
  temporaryId: string;
  tag: string | null;
  category: ComponentCategory;
  description: string;
  specifications: string[];
  manufacturer: string | null;
  modelNumber: string | null;
  confidence: number;
  evidence: string[];
  reviewStatus: ReviewStatus;
  quantity: 1;
  occurrenceTemporaryIds: string[];
};
