import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { parse, resolve } from "node:path";

export type DwgProcessRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<void>;

export type DwgConversionInput = { sourcePath: string; outputDir: string };

export interface DwgConverter {
  convert(input: DwgConversionInput): Promise<string>;
}

export type DwgConverterOptions = {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: DwgProcessRunner;
};

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

function createConversionError(code: string): Error {
  return new Error(code);
}

const defaultRunner: DwgProcessRunner = async (executable, args, options) => {
  await execFileAsync(executable, args, options);
};

function mapRunnerError(error: unknown): Error {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return createConversionError("DWG_CONVERTER_NOT_INSTALLED");
  }
  if (typeof error === "object" && error !== null && "killed" in error && error.killed === true) {
    return createConversionError("DWG_CONVERSION_TIMEOUT");
  }
  return createConversionError("DWG_CONVERSION_FAILED");
}

export function createLibreDwgConverter(options: DwgConverterOptions = {}): DwgConverter {
  const executable = options.executable ?? "dwg2dxf";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const runner = options.runner ?? defaultRunner;

  return {
    async convert(input) {
      const sourcePath = resolve(input.sourcePath);
      const outputPath = resolve(input.outputDir, `${parse(input.sourcePath).name}.dxf`);

      try {
        await runner(executable, ["--overwrite", sourcePath], {
          cwd: input.outputDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        throw mapRunnerError(error);
      }

      let outputStats;
      try {
        outputStats = await stat(outputPath);
      } catch {
        throw createConversionError("DWG_CONVERTER_OUTPUT_MISSING");
      }

      if (!outputStats.isFile() || outputStats.size === 0) {
        throw createConversionError("DWG_CONVERTER_OUTPUT_MISSING");
      }
      if (outputStats.size > maxOutputBytes) {
        throw createConversionError("DWG_CONVERTER_OUTPUT_TOO_LARGE");
      }

      return outputPath;
    },
  };
}

export const libreDwgConverter: DwgConverter = createLibreDwgConverter();
