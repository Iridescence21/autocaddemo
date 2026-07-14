import { z } from "zod";
import { COMPONENT_CATEGORIES, type ComponentCategory } from "@/lib/domain";

const categoryTuple = COMPONENT_CATEGORIES as [ComponentCategory, ...ComponentCategory[]];

export const visionDetectionSchema = z.object({
  temporaryId: z.string().min(1).max(120),
  category: z.enum(categoryTuple),
  label: z.string().max(160).nullable(),
  description: z.string().min(1).max(500),
  manufacturer: z.string().max(200).nullable(),
  modelNumber: z.string().max(200).nullable(),
  specifications: z.array(z.string().max(240)).max(30),
  confidence: z.number().min(0).max(1),
  tileId: z.string().min(1).max(120),
  location: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }).strict(),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(30),
  reviewRequired: z.boolean(),
}).strict();

export const visionResultSchema = z.object({
  drawingSummary: z.string().min(1).max(2000),
  components: z.array(visionDetectionSchema).max(1000),
  warnings: z.array(z.string().max(500)).max(50),
}).strict();

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const normalizedNumber = { type: "number", minimum: 0, maximum: 1 } as const;

export const VISION_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["drawingSummary", "components", "warnings"],
  properties: {
    drawingSummary: { type: "string" },
    components: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["temporaryId", "category", "label", "description", "manufacturer", "modelNumber", "specifications", "confidence", "tileId", "location", "evidence", "reviewRequired"],
        properties: {
          temporaryId: { type: "string" },
          category: { type: "string", enum: COMPONENT_CATEGORIES },
          label: nullableString,
          description: { type: "string" },
          manufacturer: nullableString,
          modelNumber: nullableString,
          specifications: { type: "array", items: { type: "string" } },
          confidence: normalizedNumber,
          tileId: { type: "string" },
          location: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "width", "height"],
            properties: { x: normalizedNumber, y: normalizedNumber, width: normalizedNumber, height: normalizedNumber },
          },
          evidence: { type: "array", items: { type: "string" } },
          reviewRequired: { type: "boolean" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;
