import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client/index";
import { PrismaLibSql } from "@prisma/adapter-libsql";

mkdirSync(resolve(process.cwd(), "data"), { recursive: true });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./data/dwg-electrical.db",
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function resetTestDatabase() {
  await prisma.$transaction([
    prisma.drawingExport.deleteMany(),
    prisma.bomItem.deleteMany(),
    prisma.componentCandidate.deleteMany(),
    prisma.physicalDevice.deleteMany(),
    prisma.analysisJob.deleteMany(),
    prisma.drawingMessage.deleteMany(),
    prisma.drawing.deleteMany(),
    prisma.drawingConversation.deleteMany(),
  ]);
}
