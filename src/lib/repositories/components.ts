import { prisma } from "@/lib/db";
import type { ComponentCandidate, PhysicalDevice, Prisma } from "@prisma/client/index";
import { groupPhysicalDevices, type DeviceOccurrence } from "@/lib/devices/group";
import type { ComponentInput, PhysicalDeviceInput } from "@/lib/domain";

export async function replaceComponents(drawingId: string, ownerScope: string, components: ComponentInput[]) {
  return prisma.$transaction(async (tx) => {
    const drawing = await tx.drawing.findFirst({ where: { id: drawingId, ownerScope } });
    if (!drawing) return [];
    await tx.componentCandidate.deleteMany({ where: { drawingId } });
    if (components.length) {
      await tx.componentCandidate.createMany({ data: components.map((component) => ({ ...componentData(component), drawingId })) });
    }
    await replacePhysicalDevicesInTransaction(tx, drawingId, ownerScope, groupPhysicalDevices(toDeviceOccurrences(components)));
    return tx.componentCandidate.findMany({ where: { drawingId }, orderBy: { createdAt: "asc" } });
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

export async function replacePhysicalDevices(
  drawingId: string,
  ownerScope: string,
  devices: PhysicalDeviceInput[],
): Promise<PhysicalDevice[]> {
  return prisma.$transaction(async (tx) => {
    const physicalDevices = await replacePhysicalDevicesInTransaction(tx, drawingId, ownerScope, devices);
    return physicalDevices ?? [];
  });
}

export async function replacePhysicalDevicesInTransaction(
  tx: Prisma.TransactionClient,
  drawingId: string,
  ownerScope: string,
  devices: PhysicalDeviceInput[],
): Promise<PhysicalDevice[] | null> {
  const drawing = await tx.drawing.findFirst({ where: { id: drawingId, ownerScope } });
  if (!drawing) return null;

  const assignedOccurrenceIds = new Set<string>();
  await tx.physicalDevice.deleteMany({ where: { drawingId } });
  for (const device of devices) {
    for (const occurrenceTemporaryId of device.occurrenceTemporaryIds) {
      if (assignedOccurrenceIds.has(occurrenceTemporaryId)) throw new Error("DUPLICATE_DEVICE_OCCURRENCE");
      assignedOccurrenceIds.add(occurrenceTemporaryId);
    }
    const physicalDevice = await tx.physicalDevice.create({
      data: {
        drawingId,
        temporaryId: device.temporaryId,
        tag: device.tag,
        category: device.category,
        description: device.description,
        manufacturer: device.manufacturer,
        modelNumber: device.modelNumber,
        specifications: jsonValue(device.specifications),
        confidence: device.confidence,
        evidence: jsonValue(device.evidence),
        reviewStatus: device.reviewStatus,
        quantity: device.quantity,
      },
    });
    const linked = await tx.componentCandidate.updateMany({
      where: {
        drawingId,
        temporaryId: { in: device.occurrenceTemporaryIds },
        drawing: { ownerScope },
      },
      data: { physicalDeviceId: physicalDevice.id },
    });
    if (linked.count !== device.occurrenceTemporaryIds.length) throw new Error("DEVICE_OCCURRENCE_NOT_FOUND");
  }
  return tx.physicalDevice.findMany({ where: { drawingId }, orderBy: { createdAt: "asc" } });
}

export async function generateBom(drawingId: string, ownerScope: string) {
  const drawing = await prisma.drawing.findFirst({
    where: { id: drawingId, ownerScope },
    include: { components: true, physicalDevices: { include: { occurrences: true } } },
  });
  if (!drawing) return null;
  if (!drawing.physicalDevices.length && drawing.components.length) {
    await replacePhysicalDevices(drawingId, ownerScope, groupPhysicalDevices(toDeviceOccurrencesFromPersisted(drawing.components)));
    return generateBom(drawingId, ownerScope);
  }
  const active = drawing.physicalDevices.filter((device) => device.occurrences.some((occurrence) => !occurrence.removedAt));
  const groups = new Map<string, typeof active>();
  for (const device of active) {
    const specs = JSON.stringify(device.specifications);
    const key = [device.category, device.description, device.manufacturer ?? "", device.modelNumber ?? "", specs].join("|");
    groups.set(key, [...(groups.get(key) ?? []), device]);
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

function toDeviceOccurrencesFromPersisted(components: ComponentCandidate[]): DeviceOccurrence[] {
  return components.map((component) => ({
    temporaryId: component.temporaryId,
    category: component.category as DeviceOccurrence["category"],
    tag: component.tag,
    description: component.description,
    specifications: stringValues(component.specifications),
    manufacturer: component.manufacturer,
    modelNumber: component.modelNumber,
    confidence: component.confidence,
    evidence: stringValues(component.evidence),
    reviewStatus: component.reviewStatus as DeviceOccurrence["reviewStatus"],
  }));
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
