import { describe, expect, it } from "vitest";
import {
  groupPhysicalDevices,
  type DeviceOccurrence,
} from "@/lib/devices/group";

function occurrence(overrides: Partial<DeviceOccurrence> & Pick<DeviceOccurrence, "temporaryId">): DeviceOccurrence {
  return {
    category: "relay",
    tag: null,
    description: "Control relay",
    specifications: ["24VDC"],
    manufacturer: null,
    modelNumber: null,
    confidence: 0.8,
    evidence: ["fixture evidence"],
    reviewStatus: "confirmed",
    ...overrides,
  };
}

describe("groupPhysicalDevices", () => {
  it("groups repeated occurrences with the same normalized tag into one device", () => {
    const groups = groupPhysicalDevices([
      occurrence({ temporaryId: "KM1-coil", tag: "KM1", category: "contactor" }),
      occurrence({ temporaryId: "KM1-contact-1", tag: "km1", category: "switch" }),
      occurrence({ temporaryId: "KM1-contact-2", tag: " KM1 ", category: "switch" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      tag: "KM1",
      category: "contactor",
      quantity: 1,
      confidence: 0.8,
      reviewStatus: "requires_review",
      occurrenceTemporaryIds: ["KM1-coil", "KM1-contact-1", "KM1-contact-2"],
    });
    expect(groups[0]?.evidence).toEqual(expect.arrayContaining([
      "occurrence:KM1-coil",
      "occurrence:KM1-contact-1",
      "occurrence:KM1-contact-2",
    ]));
  });

  it("keeps unlabeled occurrences as separate physical devices", () => {
    const groups = groupPhysicalDevices([
      occurrence({ temporaryId: "motor-a", category: "motor", modelNumber: "M-100" }),
      occurrence({ temporaryId: "motor-b", category: "motor", modelNumber: "M-100" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.occurrenceTemporaryIds)).toEqual([["motor-a"], ["motor-b"]]);
  });

  it("prefers a relay representative over a higher-confidence switch contact", () => {
    const [group] = groupPhysicalDevices([
      occurrence({ temporaryId: "KA1-coil", tag: "KA1", category: "relay", confidence: 0.62 }),
      occurrence({ temporaryId: "KA1-contact", tag: "KA1", category: "switch", confidence: 0.98 }),
    ]);

    expect(group).toMatchObject({
      category: "relay",
      description: "Control relay",
      confidence: 0.62,
      reviewStatus: "requires_review",
    });
  });

  it("requires review for tagged groups with an unknown category conflict", () => {
    const [group] = groupPhysicalDevices([
      occurrence({ temporaryId: "X1-device", tag: "X1", category: "motor", reviewStatus: "confirmed" }),
      occurrence({ temporaryId: "X1-unknown", tag: "X1", category: "unknown", confidence: 0.99, reviewStatus: "confirmed" }),
    ]);

    expect(group).toMatchObject({ reviewStatus: "requires_review" });
  });
});
