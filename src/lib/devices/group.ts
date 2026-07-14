import type { ComponentCategory, PhysicalDeviceInput, ReviewStatus } from "@/lib/domain";

export type DeviceOccurrence = {
  temporaryId: string;
  category: ComponentCategory;
  tag: string | null;
  description: string;
  specifications: string[];
  manufacturer: string | null;
  modelNumber: string | null;
  confidence: number;
  evidence: string[];
  reviewStatus: ReviewStatus;
};

export type GroupedPhysicalDevice = PhysicalDeviceInput;

// A contactor or relay is the physical device; its switch-like contacts are occurrences of it.
// This order is deterministic and takes precedence over confidence for a tagged mixed group.
const DEVICE_CATEGORY_PRECEDENCE: ComponentCategory[] = ["contactor", "relay"];

export function groupPhysicalDevices(occurrences: DeviceOccurrence[]): GroupedPhysicalDevice[] {
  const groups = new Map<string, DeviceOccurrence[]>();
  for (const occurrence of occurrences) {
    const tag = normalizeTag(occurrence.tag);
    const key = tag ? `tag:${tag}` : `occurrence:${occurrence.temporaryId}`;
    groups.set(key, [...(groups.get(key) ?? []), occurrence]);
  }
  return [...groups.entries()].map(([key, items], index) => buildDevice(`device-${index + 1}`, key, items));
}

function buildDevice(temporaryId: string, key: string, occurrences: DeviceOccurrence[]): GroupedPhysicalDevice {
  const representative = selectRepresentative(occurrences);
  const categories = new Set(occurrences.map((occurrence) => occurrence.category));
  const requiresReview = categories.size > 1 || occurrences.some((occurrence) => occurrence.reviewStatus !== "confirmed");

  return {
    temporaryId,
    tag: key.startsWith("tag:") ? key.slice(4) : null,
    category: representative.category,
    description: representative.description,
    specifications: representative.specifications,
    manufacturer: representative.manufacturer,
    modelNumber: representative.modelNumber,
    confidence: Math.min(...occurrences.map((occurrence) => occurrence.confidence)),
    evidence: [
      ...new Set([
        ...occurrences.flatMap((occurrence) => occurrence.evidence),
        ...occurrences.map((occurrence) => `occurrence:${occurrence.temporaryId}`),
      ]),
    ],
    reviewStatus: requiresReview ? "requires_review" : representative.reviewStatus,
    quantity: 1,
    occurrenceTemporaryIds: occurrences.map((occurrence) => occurrence.temporaryId),
  };
}

function selectRepresentative(occurrences: DeviceOccurrence[]) {
  const precedenceCategory = DEVICE_CATEGORY_PRECEDENCE.find((category) => occurrences.some((occurrence) => occurrence.category === category));
  const candidates = precedenceCategory
    ? occurrences.filter((occurrence) => occurrence.category === precedenceCategory)
    : occurrences;
  return candidates.reduce((best, occurrence) => occurrence.confidence > best.confidence ? occurrence : best);
}

function normalizeTag(tag: string | null) {
  const normalized = tag?.trim().toUpperCase();
  return normalized || null;
}
