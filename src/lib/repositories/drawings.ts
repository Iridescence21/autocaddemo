import type { ComponentInput } from "@/lib/domain";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client/index";
import { groupPhysicalDevices, type DeviceOccurrence } from "@/lib/devices/group";
import { replacePhysicalDevicesInTransaction } from "@/lib/repositories/components";

export async function createDrawingUpload(input: {
  conversationId: string;
  ownerScope: string;
  originalFilename: string;
  safeFilename: string;
  storageKey: string;
  sourceType: "dwg" | "dxf";
  byteSize: number;
  initialComponents?: ComponentInput[];
}) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.drawingConversation.findFirst({ where: { id: input.conversationId, ownerScope: input.ownerScope } });
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    const drawing = await tx.drawing.create({
      data: {
        conversationId: input.conversationId,
        ownerScope: input.ownerScope,
        originalFilename: input.originalFilename,
        safeFilename: input.safeFilename,
        storageKey: input.storageKey,
        sourceType: input.sourceType,
        byteSize: input.byteSize,
        status: "uploaded",
        analysisJob: { create: { status: "queued", stage: "等待分析", progress: 0 } },
      },
      include: { analysisJob: true },
    });
    if (input.initialComponents?.length) {
      await tx.componentCandidate.createMany({ data: input.initialComponents.map((component) => ({ ...componentData(component), drawingId: drawing.id })) });
      await replacePhysicalDevicesInTransaction(tx, drawing.id, input.ownerScope, groupPhysicalDevices(toDeviceOccurrences(input.initialComponents)));
    }
    await tx.drawingConversation.update({ where: { id: input.conversationId }, data: { status: "queued" } });
    return drawing;
  });
}

function componentData(component: ComponentInput) {
  return {
    temporaryId: component.temporaryId,
    category: component.category,
    tag: component.tag ?? null,
    description: component.description,
    specifications: component.specifications,
    manufacturer: component.manufacturer ?? null,
    modelNumber: component.modelNumber ?? null,
    confidence: component.confidence,
    evidence: component.evidence,
    method: component.method,
    reviewStatus: component.reviewStatus,
    sourceTileId: component.sourceTileId ?? null,
    location: component.location ?? { x: 0, y: 0, width: 0, height: 0 },
  };
}

export async function updateAnalysisStatus(
  drawingId: string,
  ownerScope: string,
  input: { status: string; progress: number; stage: string; errorCode?: string; errorMessage?: string },
) {
  const drawing = await prisma.drawing.findFirst({ where: { id: drawingId, ownerScope } });
  if (!drawing) return false;
  await prisma.$transaction([
    prisma.analysisJob.update({ where: { drawingId }, data: input }),
    prisma.drawing.update({ where: { id: drawingId }, data: { status: input.status } }),
    prisma.drawingConversation.update({ where: { id: drawing.conversationId }, data: { status: input.status } }),
  ]);
  return true;
}

export async function getDrawingForOwner(drawingId: string, ownerScope: string) {
  return prisma.drawing.findFirst({ where: { id: drawingId, ownerScope } });
}

export async function saveDrawingPreview(drawingId: string, ownerScope: string, preview: { overviewImageUrl: string; width: number; height: number; tiles: unknown[] }) {
  const result = await prisma.drawing.updateMany({
    where: { id: drawingId, ownerScope },
    data: { previewImageUrl: preview.overviewImageUrl, previewWidth: preview.width, previewHeight: preview.height, previewTiles: JSON.parse(JSON.stringify(preview.tiles)) as Prisma.InputJsonValue },
  });
  return result.count > 0;
}

export async function getAnalysisSnapshot(drawingId: string, ownerScope: string) {
  const drawing = await prisma.drawing.findFirst({
    where: { id: drawingId, ownerScope },
    include: {
      analysisJob: true,
      components: { orderBy: { createdAt: "asc" } },
      physicalDevices: { orderBy: { createdAt: "asc" } },
      bomItems: { orderBy: { itemNumber: "asc" } },
    },
  });
  if (!drawing) return null;
  return {
    drawing,
    job: drawing.analysisJob,
    components: drawing.components,
    physicalDevices: drawing.physicalDevices,
    bomItems: drawing.bomItems,
  };
}

function toDeviceOccurrences(components: ComponentInput[]): DeviceOccurrence[] {
  return components.map((component) => ({
    temporaryId: component.temporaryId,
    category: component.category,
    tag: component.tag ?? null,
    description: component.description,
    specifications: component.specifications,
    manufacturer: component.manufacturer ?? null,
    modelNumber: component.modelNumber ?? null,
    confidence: component.confidence,
    evidence: component.evidence,
    reviewStatus: component.reviewStatus,
  }));
}

export async function getJobSnapshot(jobId: string, ownerScope: string) {
  return prisma.analysisJob.findFirst({ where: { id: jobId, drawing: { ownerScope } }, include: { drawing: true } });
}
