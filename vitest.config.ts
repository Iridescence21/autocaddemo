import path from "node:path";
import { defineConfig } from "vitest/config";

const defaultTestDatabase = process.platform === "darwin"
  ? "/tmp/dwg-electrical-test.db"
  : path.resolve(__dirname, "data/dwg-electrical-test.db");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? `file:${defaultTestDatabase}`;

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
  },
});
