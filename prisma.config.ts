import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolve } from "node:path";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), "data", "dwg-electrical.db")}`,
  },
});
