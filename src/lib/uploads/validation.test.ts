import { describe, expect, it } from "vitest";
import { validateCadUpload } from "@/lib/uploads/validation";

function upload(name: string, type: string, content: string) {
  const bytes = Buffer.from(content, "utf8");
  return { name, type, size: bytes.byteLength, bytes };
}

describe("CAD upload validation", () => {
  it("accepts a DWG with a real-style version header", () => {
    const result = validateCadUpload(upload("Control Panel A.dwg", "application/acad", "AC1027\nDWG-ELECTRICAL-DEMO:control-panel-a"));
    expect(result).toMatchObject({ sourceType: "dwg", safeFilename: "Control-Panel-A.dwg" });
  });

  it("accepts an ASCII DXF with section markers", () => {
    const result = validateCadUpload(upload("motor-cabinet-02.dxf", "application/dxf", "0\nSECTION\n2\nHEADER\n0\nENDSEC\nDXF-ELECTRICAL-DEMO:motor-cabinet-02"));
    expect(result.sourceType).toBe("dxf");
  });

  it("rejects an unsupported file, a forged header, and an oversized file", () => {
    expect(() => validateCadUpload(upload("drawing.pdf", "application/pdf", "AC1027"))).toThrowError(/UNSUPPORTED_FILE_TYPE/);
    expect(() => validateCadUpload(upload("drawing.dwg", "application/acad", "not a drawing"))).toThrowError(/INVALID_CAD_SIGNATURE/);
    const bytes = Buffer.alloc(26 * 1024 * 1024, 1);
    expect(() => validateCadUpload({ name: "big.dwg", type: "application/acad", size: bytes.length, bytes })).toThrowError(/FILE_TOO_LARGE/);
  });

  it("sanitizes path traversal without using it as a storage key", () => {
    const result = validateCadUpload(upload("../../secret panel.dwg", "application/acad", "AC1027\nDWG-ELECTRICAL-DEMO:control-panel-a"));
    expect(result.safeFilename).toBe("secret-panel.dwg");
    expect(result.safeFilename).not.toContain("/");
  });
});
