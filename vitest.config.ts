import path from "node:path";
import { defineConfig } from "vitest/config";

process.env.DATABASE_URL = "file:./data/dwg-electrical-test.db";

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
