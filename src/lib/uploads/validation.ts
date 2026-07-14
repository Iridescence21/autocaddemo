import path from "node:path";

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type CadUpload = { name: string; type: string; size: number; bytes: Buffer };
export type ValidatedCadUpload = CadUpload & { sourceType: "dwg" | "dxf"; safeFilename: string };

function maxUploadBytes() {
  const configured = Number(process.env.MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

function safeName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  return base || "drawing.cad";
}

function sourceTypeFor(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".dwg") return "dwg" as const;
  if (extension === ".dxf") return "dxf" as const;
  throw new Error("UNSUPPORTED_FILE_TYPE");
}

function hasSignature(sourceType: "dwg" | "dxf", bytes: Buffer) {
  if (sourceType === "dwg") return bytes.subarray(0, 6).toString("ascii").startsWith("AC10");
  const header = bytes.subarray(0, 4096).toString("utf8");
  return /(?:^|\n)\s*SECTION\s*(?:\r?\n)\s*2\s*(?:\r?\n)\s*HEADER/i.test(header);
}

export function validateCadUpload(input: CadUpload): ValidatedCadUpload {
  if (!input || !input.name || !input.bytes || input.size !== input.bytes.byteLength) throw new Error("INVALID_UPLOAD");
  if (input.size > maxUploadBytes()) throw new Error("FILE_TOO_LARGE");
  const sourceType = sourceTypeFor(input.name);
  if (!hasSignature(sourceType, input.bytes)) throw new Error("INVALID_CAD_SIGNATURE");
  return { ...input, sourceType, safeFilename: safeName(input.name) };
}

export const uploadLimitBytes = maxUploadBytes;
