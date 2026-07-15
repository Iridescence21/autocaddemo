import { prisma } from "@/lib/db";

export async function createConversation(input: { ownerScope: string; title: string }) {
  return prisma.drawingConversation.create({ data: input });
}

export async function listConversations(ownerScope: string) {
  return prisma.drawingConversation.findMany({
    where: { ownerScope },
    include: { drawing: { include: { analysisJob: true, components: { where: { removedAt: null } } } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getConversation(id: string, ownerScope: string) {
  return prisma.drawingConversation.findFirst({
    where: { id, ownerScope },
    include: { drawing: { include: { analysisJob: true, components: true, physicalDevices: true, bomItems: true } } },
  });
}

export async function updateConversation(id: string, ownerScope: string, data: { title?: string; status?: string }) {
  const result = await prisma.drawingConversation.updateMany({ where: { id, ownerScope }, data });
  return result.count > 0;
}

export async function deleteConversation(id: string, ownerScope: string) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.drawingConversation.findFirst({
      where: { id, ownerScope },
      select: { drawing: { select: { id: true } } },
    });
    if (!conversation) return false;
    if (conversation.drawing) {
      await tx.componentCandidate.updateMany({
        where: { drawingId: conversation.drawing.id, physicalDeviceId: { not: null } },
        data: { physicalDeviceId: null },
      });
    }
    const result = await tx.drawingConversation.deleteMany({ where: { id, ownerScope } });
    return result.count > 0;
  });
}
