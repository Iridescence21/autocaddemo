import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client/index";
import type { ComponentInput } from "@/lib/domain";

export async function replaceComponents(drawingId: string, ownerScope: string, components: ComponentInput[]) {
  const drawing = await prisma.drawing.findFirst({ where: { id: drawingId, ownerScope } });
  if (!drawing) return [];
  await prisma.componentCandidate.deleteMany({ where: { drawingId } });
  if (components.length) {
    await prisma.componentCandidate.createMany({ data: components.map((component) => ({ ...componentData(component), drawingId })) });
  }
  return prisma.componentCandidate.findMany({ where: { drawingId }, orderBy: { createdAt: "asc" } });
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

export async function updateComponent(
  drawingId: string,
  componentId: string,
  ownerScope: string,
  data: { category?: string; tag?: string; description?: string; reviewStatus?: string },
) {
  const component = await prisma.componentCandidate.findFirst({ where: { id: componentId, drawingId, drawing: { ownerScope } } });
  if (!component) return null;
  return prisma.componentCandidate.update({
    where: { id: component.id },
    data: {
      ...data,
      ...(data.category && data.category !== component.category ? { originalCategory: component.category, correctedCategory: data.category } : {}),
    },
  });
}

export async function removeComponent(drawingId: string, componentId: string, ownerScope: string) {
  const result = await prisma.componentCandidate.updateMany({
    where: { id: componentId, drawingId, drawing: { ownerScope } },
    data: { removedAt: new Date(), reviewStatus: "removed" },
  });
  return result.count > 0;
}

export async function generateBom(drawingId: string, ownerScope: string) {
  const drawing = await prisma.drawing.findFirst({ where: { id: drawingId, ownerScope }, include: { components: true } });
  if (!drawing) return null;
  const active = drawing.components.filter((component) => !component.removedAt);
  const groups = new Map<string, typeof active>();
  for (const component of active) {
    const specs = JSON.stringify(component.specifications);
    const key = [component.category, component.description, component.manufacturer ?? "", component.modelNumber ?? "", specs].join("|");
    groups.set(key, [...(groups.get(key) ?? []), component]);
  }
  await prisma.bomItem.deleteMany({ where: { drawingId } });
  const items = [...groups.values()].map((group, index) => ({
    drawingId,
    itemNumber: index + 1,
    category: group[0].category,
    description: group[0].description,
    manufacturer: group[0].manufacturer,
    modelNumber: group[0].modelNumber,
    specifications: JSON.parse(JSON.stringify(group[0].specifications)) as Prisma.InputJsonValue,
    quantity: group.length,
    confidence: Math.min(...group.map((item) => item.confidence)),
    reviewStatus: group.some((item) => item.reviewStatus !== "confirmed") ? "requires_review" : "confirmed",
  }));
  if (items.length) await prisma.bomItem.createMany({ data: items });
  return { items: await prisma.bomItem.findMany({ where: { drawingId }, orderBy: { itemNumber: "asc" } }) };
}
