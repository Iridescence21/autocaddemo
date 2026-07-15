import { describe, expect, it } from "vitest";

describe("test database isolation", () => {
  it("never points automated tests at the live demo database", () => {
    expect(process.env.DATABASE_URL).toMatch(/dwg-electrical-test\.db$/);
    expect(process.env.DATABASE_URL).not.toMatch(/(^|\/)dwg-electrical\.db$/);
  });
});
