import { describe, expect, it } from "vitest";
import {
  assertHybridSmokeSummary,
  type HybridSmokeSummary,
} from "../../../scripts/smoke-hybrid-dwg";

function summary(overrides: Partial<HybridSmokeSummary> = {}): HybridSmokeSummary {
  return {
    source: "M-T1-02.dwg",
    overview: { width: 2048, height: 520 },
    counts: { entities: 2491, texts: 968, blocks: 42, layers: 19 },
    tiles: { count: 20, coverageLimited: false },
    structural: { count: 120, tags: ["TA1", "KA1", "YCT1"] },
    ...overrides,
  };
}

describe("hybrid DWG smoke gate", () => {
  it("accepts a non-empty summary with required native tags", () => {
    expect(() => assertHybridSmokeSummary(summary(), ["TA1", "KA1", "YCT1"])).not.toThrow();
  });

  it.each([
    ["HYBRID_SMOKE_EMPTY_ENTITIES", { counts: { entities: 0, texts: 968, blocks: 42, layers: 19 } }],
    ["HYBRID_SMOKE_EMPTY_IMAGE", { overview: { width: 0, height: 520 } }],
    ["HYBRID_SMOKE_EMPTY_TILES", { tiles: { count: 0, coverageLimited: true } }],
    ["HYBRID_SMOKE_REQUIRED_TAG_MISSING", { structural: { count: 2, tags: ["TA1", "KA1"] } }],
  ])("rejects %s", (code, overrides) => {
    expect(() => assertHybridSmokeSummary(summary(overrides), ["TA1", "KA1", "YCT1"])).toThrow(code);
  });
});
