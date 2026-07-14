import { prisma } from "@/lib/db";
import type { ComponentCandidate, PhysicalDevice, Prisma } from "@prisma/client/index";
import { groupPhysicalDevices, type DeviceOccurrence } from "@/lib/devices/group";
import type { ComponentInput, PhysicalDeviceInput } from "@/lib/domain";

export function assertUniqueComponentTemporaryIds(components: ComponentInput[]) {
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.temporaryId)) throw new Error("DUPLICATE_COMPONENT_TEMPORARY_ID");
    seen.add(component.temporaryId);
  }
}

export async function replaceComponents(drawingId: string, ownerScope: string, components: ComponentInput[]) {
  return prisma.$transaction(async (tx) => {
    const drawing = await tx.drawing.findFirst({ where: { id: drawingId, ownerScope } });
    if (!drawing) return [];
    assertUniqueComponentTemporaryIds(components);
    await tx.componentCandidate.deleteMany({ where: { drawingId } });
    if (components.length) {
      await tx.componentCandidate.createMany({ data: components.map((component) => ({ ...componentData(component), drawingId })) });
    }
    await regroupActivePhysicalDevicesInTransaction(tx, drawingId, ownerScope);
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
  return prisma.$transaction(async (tx) => {
    const component = await tx.componentCandidate.findFirst({ where: { id: componentId, drawingId, drawing: { ownerScope } } });
    if (!component) return null;
    const updated = await tx.componentCandidate.update({
      where: { id: component.id },
      data: {
        ...data,
        ...(data.category && data.category !== component.category ? { originalCategory: component.category, correctedCategory: data.category } : {}),
      },
    });
    await regroupActivePhysicalDevicesInTransaction(tx, drawingId, ownerScope);
    await generateBomInTransaction(tx, drawingId);
    return tx.componentCandidate.findUnique({ where: { id: updated.id } });
  });
}

export async function removeComponent(drawingId: string, componentId: string, ownerScope: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.componentCandidate.updateMany({
      where: { id: componentId, drawingId, drawing: { ownerScope } },
      data: { removedAt: new Date(), reviewStatus: "removed" },
    });
    if (!result.count) return false;
    await regroupActivePhysicalDevicesInTransaction(tx, drawingId, ownerScope);
    await generateBomInTransaction(tx, drawingId);
    return true;
  });
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

  const assignedOccurrenceKeys = new Set<string>();
  for (const device of devices) {
    const occurrenceKeys = device.occurrenceIds?.length ? device.occurrenceIds : device.occurrenceTemporaryIds;
    if (device.occurrenceIds && device.occurrenceIds.length !== device.occurrenceTemporaryIds.length) {
      throw new Error("DEVICE_OCCURRENCE_ID_MISMATCH");
    }
    for (const occurrenceKey of occurrenceKeys) {
      const key = `${device.occurrenceIds?.length ? "id" : "temporaryId"}:${occurrenceKey}`;
      if (assignedOccurrenceKeys.has(key)) throw new Error("DUPLICATE_DEVICE_OCCURRENCE");
      assignedOccurrenceKeys.add(key);
    }
  }

  await tx.componentCandidate.updateMany({
    where: { drawingId, physicalDeviceId: { not: null } },
    data: { physicalDeviceId: null, physicalDeviceDrawingId: null },
  });
  await tx.physicalDevice.deleteMany({ where: { drawingId } });
  for (const device of devices) {
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
        ...(device.occurrenceIds?.length
          ? { id: { in: device.occurrenceIds } }
          : { temporaryId: { in: device.occurrenceTemporaryIds } }),
        drawing: { ownerScope },
      },
      data: { physicalDeviceId: physicalDevice.id, physicalDeviceDrawingId: drawingId },
    });
    const expectedLinks = device.occurrenceIds?.length ?? device.occurrenceTemporaryIds.length;
    if (linked.count !== expectedLinks) throw new Error("DEVICE_OCCURRENCE_NOT_FOUND");
  }
  return tx.physicalDevice.findMany({ where: { drawingId }, orderBy: { createdAt: "asc" } });
}

export async function regroupActivePhysicalDevicesInTransaction(
  tx: Prisma.TransactionClient,
  drawingId: string,
  ownerScope: string,
) {
  const activeComponents = await tx.componentCandidate.findMany({
    where: { drawingId, removedAt: null, drawing: { ownerScope } },
    orderBy: { createdAt: "asc" },
  });
  return replacePhysicalDevicesInTransaction(tx, drawingId, ownerScope, groupPhysicalDevices(toDeviceOccurrencesFromPersisted(activeComponents)));
}

export async function generateBom(drawingId: string, ownerScope: string) {
  return prisma.$transaction(async (tx) => {
    const drawing = await tx.drawing.findFirst({ where: { id: drawingId, ownerScope } });
    if (!drawing) return null;
    const physicalDeviceCount = await tx.physicalDevice.count({ where: { drawingId } });
    const activeComponentCount = await tx.componentCandidate.count({ where: { drawingId, removedAt: null } });
    if (!physicalDeviceCount && activeComponentCount) await regroupActivePhysicalDevicesInTransaction(tx, drawingId, ownerScope);
    return generateBomInTransaction(tx, drawingId);
  });
}

async function generateBomInTransaction(tx: Prisma.TransactionClient, drawingId: string) {
  const physicalDevices = await tx.physicalDevice.findMany({
    where: { drawingId },
    include: { occurrences: true },
  });
  const active = physicalDevices.filter((device) => device.occurrences.some((occurrence) => !occurrence.removedAt));
  const groups = new Map<string, typeof active>();
  for (const device of active) {
    const key = JSON.stringify([
      device.category,
      device.description,
      device.manufacturer,
      device.modelNumber,
      device.specifications,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }
  await tx.bomItem.deleteMany({ where: { drawingId } });
  const items = [...groups.values()].map((group, index) => ({
    drawingId,
    itemNumber: index + 1,
    category: group[0].category,
    description: group[0].description,
    manufacturer: group[0].manufacturer,
    modelNumber: group[0].modelNumber,
    specifications: jsonValue(group[0].specifications),
    quantity: group.length,
    confidence: Math.min(...group.map((item) => item.confidence)),
    reviewStatus: group.some((item) => item.reviewStatus !== "confirmed") ? "requires_review" : "confirmed",
  }));
  if (items.length) await tx.bomItem.createMany({ data: items });
  return { items: await tx.bomItem.findMany({ where: { drawingId }, orderBy: { itemNumber: "asc" } }) };
}

function toDeviceOccurrencesFromPersisted(components: ComponentCandidate[]): DeviceOccurrence[] {
  const temporaryIdCounts = new Map<string, number>();
  for (const component of components) temporaryIdCounts.set(component.temporaryId, (temporaryIdCounts.get(component.temporaryId) ?? 0) + 1);
  return components.map((component) => ({
    temporaryId: component.temporaryId,
    groupingKey: temporaryIdCounts.get(component.temporaryId)! > 1 ? component.id : component.temporaryId,
    occurrenceId: component.id,
    category: component.category as DeviceOccurrence["category"],
    tag: component.tag,
    description: component.description,
    specifications: stringValues(component.specifications),
    manufacturer: component.manufacturer,
    modelNumber: component.modelNumber,
    confidence: component.confidence,
    evidence: [...stringValues(component.evidence), `component:${component.id}`],
    reviewStatus: component.reviewStatus as DeviceOccurrence["reviewStatus"],
  }));
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
