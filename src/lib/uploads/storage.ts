import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function storeCadUpload(input: { drawingId: string; ownerScope: string; safeFilename: string; bytes: Buffer }) {
  const relativeDirectory = resolve("data", "uploads", input.ownerScope, input.drawingId);
  await mkdir(relativeDirectory, { recursive: true });
  const storageKey = `${input.ownerScope}/${input.drawingId}/${input.safeFilename}`;
  await writeFile(resolve(relativeDirectory, input.safeFilename), input.bytes, { flag: "wx" });
  return { storageKey, absolutePath: resolve(relativeDirectory, input.safeFilename), byteSize: input.bytes.byteLength };
}
