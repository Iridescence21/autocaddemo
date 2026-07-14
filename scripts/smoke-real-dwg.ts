import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { basename, join, resolve } from "node:path";
import { libreDwgConverter } from "../src/lib/cad/dwg-converter";
import { parseDxfFile } from "../src/lib/cad/dxf-parser";

const execFileAsync = promisify(execFile);

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dwg-electrical-smoke-"));
  const fixturePath = resolve(process.cwd(), "fixtures/cad/synthetic-control-panel.dxf");
  const sourcePath = join(temporaryDirectory, basename(fixturePath));
  const dwgPath = join(temporaryDirectory, "synthetic-control-panel.dwg");
  const outputPath = resolve(process.cwd(), "data/smoke/synthetic-control-panel.dwg");

  try {
    await mkdir(resolve(process.cwd(), "data/smoke"), { recursive: true });
    await copyFile(fixturePath, sourcePath);
    await execFileAsync("dxf2dwg", ["--overwrite", basename(sourcePath)], { cwd: temporaryDirectory });

    const dwgStats = await stat(dwgPath);
    if (!dwgStats.isFile() || dwgStats.size === 0) throw new Error("Generated DWG is missing or empty");
    const signature = (await readFile(dwgPath)).subarray(0, 4).toString("ascii");
    if (!signature.startsWith("AC10")) throw new Error(`Generated DWG has unexpected signature: ${signature}`);

    const convertedDxfPath = await libreDwgConverter.convert({ sourcePath: dwgPath, outputDir: temporaryDirectory });
    const drawing = await parseDxfFile(convertedDxfPath);
    if (drawing.entities.length === 0) throw new Error("DWG round trip produced no entities");
    if (drawing.texts.length === 0) throw new Error("DWG round trip produced no text items");

    await copyFile(dwgPath, outputPath);
    console.log(JSON.stringify({ dwgBytes: dwgStats.size, entities: drawing.entities.length, texts: drawing.texts.length, outputPath }, null, 2));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Real DWG smoke test failed");
  process.exitCode = 1;
});
