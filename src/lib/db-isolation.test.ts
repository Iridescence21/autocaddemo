import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("test database isolation", () => {
  it("never points automated tests at the live demo database", () => {
    expect(process.env.DATABASE_URL).toMatch(/dwg-electrical-test\.db$/);
    expect(process.env.DATABASE_URL).not.toMatch(/(^|\/)dwg-electrical\.db$/);
  });

  it("resolves the Prisma CLI default database from the project root", async () => {
    const source = await readFile(resolve(process.cwd(), "prisma.config.ts"), "utf8");

    expect(source).toContain('resolve(process.cwd(), "data", "dwg-electrical.db")');
    expect(source).not.toContain('"file:./data/dwg-electrical.db"');
  });
});
