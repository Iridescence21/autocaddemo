import { prisma } from "@/lib/db";

export async function appendMessage(
  conversationId: string,
  input: { ownerScope: string; type: string; role: string; payload: object },
) {
  const conversation = await prisma.drawingConversation.findFirst({ where: { id: conversationId, ownerScope: input.ownerScope } });
  if (!conversation) return null;
  return prisma.drawingMessage.create({ data: { conversationId, ...input } });
}

export async function listMessages(conversationId: string, ownerScope: string) {
  return prisma.drawingMessage.findMany({
    where: { conversationId, ownerScope },
    orderBy: { createdAt: "asc" },
  });
}
