import { execFileSync } from "node:child_process";

export default function setupTestDatabase() {
  execFileSync("npx", ["prisma", "db", "push"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "pipe",
  });
}
