import type { AttachmentsProps } from "@ant-design/x";

export type DrawingComponent = {
  id: string;
  temporaryId: string;
  category: string;
  tag: string | null;
  description: string;
  specifications: unknown;
  manufacturer: string | null;
  modelNumber: string | null;
  confidence: number;
  evidence: unknown;
  method: string;
  reviewStatus: string;
  physicalDeviceId?: string | null;
  location: unknown;
  removedAt: string | null;
};

export type BomItem = {
  id: string;
  itemNumber: number;
  category: string;
  description: string;
  manufacturer: string | null;
  modelNumber: string | null;
  specifications: unknown;
  quantity: number;
  confidence: number;
  reviewStatus: string;
};

export type PhysicalDevice = {
  id: string;
  temporaryId: string;
  tag: string | null;
  category: string;
  reviewStatus: string;
};

export type Drawing = {
  id: string;
  originalFilename: string;
  sourceType: string;
  byteSize: number;
  status: string;
  previewImageUrl?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  analysisJob?: { id: string; status: string; progress: number; stage: string; errorMessage?: string | null } | null;
  components: DrawingComponent[];
  physicalDevices: PhysicalDevice[];
  bomItems: BomItem[];
};

export type Conversation = {
  id: string;
  title: string;
  status: string;
  updatedAt?: string;
  drawing?: Drawing | null;
};

export type MessageRecord = {
  id: string;
  type: string;
  role: string;
  payload: unknown;
  createdAt: string;
};

export type AttachmentItem = NonNullable<AttachmentsProps["items"]>[number];
export type InspectorView = "drawing" | "files" | "components" | "review" | "bom";

export type SessionFile = {
  key: string;
  name: string;
  kind: "source" | "preview" | "export";
  description: string;
  byteSize?: number;
  previewUrl?: string;
  createdAt?: string;
};

export type SessionFileGroup = {
  key: "source" | "artifacts" | "exports";
  title: string;
  files: SessionFile[];
};
