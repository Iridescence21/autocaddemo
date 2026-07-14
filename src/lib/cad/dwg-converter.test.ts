import { mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createLibreDwgConverter, type DwgProcessRunner } from "./dwg-converter";

async function makeTempDirectory() {
  const directory = join(tmpdir(), `dwg-converter-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("createLibreDwgConverter", () => {
  it("runs dwg2dxf and returns the generated ASCII DXF path", async () => {
    const directory = await makeTempDirectory();
    const sourcePath = join(directory, "panel.dwg");
    await writeFile(sourcePath, "DWG");
    const calls: Array<{ executable: string; args: string[]; options: Parameters<DwgProcessRunner>[2] }> = [];
    const runner: DwgProcessRunner = async (executable, args, options) => {
      calls.push({ executable, args, options });
      await writeFile(join(options.cwd, `${parse(sourcePath).name}.dxf`), "0\nSECTION\nASCII DXF\n");
    };

    try {
      const result = await createLibreDwgConverter({ runner }).convert({ sourcePath, outputDir: directory });

      expect(result).toBe(join(directory, "panel.dxf"));
      expect(calls).toEqual([{
        executable: "dwg2dxf",
        args: ["--overwrite", sourcePath],
        options: { cwd: directory, timeout: 60000, maxBuffer: 1024 * 1024 },
      }]);
      await expect(readFile(result, "utf8")).resolves.toContain("ASCII DXF");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows the default 100 MiB output limit", async () => {
    const directory = await makeTempDirectory();
    const sourcePath = join(directory, "panel.dwg");
    const outputPath = join(directory, "panel.dxf");
    await writeFile(sourcePath, "DWG");

    try {
      const runner: DwgProcessRunner = async () => {
        await writeFile(outputPath, "");
        await truncate(outputPath, 100 * 1024 * 1024);
      };

      await expect(createLibreDwgConverter({ runner }).convert({ sourcePath, outputDir: directory }))
        .resolves.toBe(outputPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("throws DWG_CONVERTER_OUTPUT_MISSING when conversion produces no DXF", async () => {
    const directory = await makeTempDirectory();
    const sourcePath = join(directory, "panel.dwg");
    await writeFile(sourcePath, "DWG");

    try {
      await expect(createLibreDwgConverter({ runner: async () => {} }).convert({ sourcePath, outputDir: directory }))
        .rejects.toThrow("DWG_CONVERTER_OUTPUT_MISSING");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("throws DWG_CONVERTER_OUTPUT_TOO_LARGE when the DXF exceeds the size limit", async () => {
    const directory = await makeTempDirectory();
    const sourcePath = join(directory, "panel.dwg");
    await writeFile(sourcePath, "DWG");

    try {
      const runner: DwgProcessRunner = async (_executable, _args, options) => {
        await writeFile(join(options.cwd, "panel.dxf"), "too large");
      };
      await expect(createLibreDwgConverter({ runner, maxOutputBytes: 3 }).convert({ sourcePath, outputDir: directory }))
        .rejects.toThrow("DWG_CONVERTER_OUTPUT_TOO_LARGE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps ENOENT runner errors to DWG_CONVERTER_NOT_INSTALLED", async () => {
    const error = Object.assign(new Error("missing executable"), { code: "ENOENT" });
    await expect(createLibreDwgConverter({ runner: async () => { throw error; } }).convert({ sourcePath: "panel.dwg", outputDir: "." }))
      .rejects.toThrow("DWG_CONVERTER_NOT_INSTALLED");
  });

  it("maps killed runner errors to DWG_CONVERSION_TIMEOUT", async () => {
    const error = Object.assign(new Error("timed out"), { killed: true });
    await expect(createLibreDwgConverter({ runner: async () => { throw error; } }).convert({ sourcePath: "panel.dwg", outputDir: "." }))
      .rejects.toThrow("DWG_CONVERSION_TIMEOUT");
  });

  it("maps other runner errors to DWG_CONVERSION_FAILED", async () => {
    await expect(createLibreDwgConverter({ runner: async () => { throw new Error("conversion failed"); } }).convert({ sourcePath: "panel.dwg", outputDir: "." }))
      .rejects.toThrow("DWG_CONVERSION_FAILED");
  });
});
