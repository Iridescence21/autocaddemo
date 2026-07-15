# Electrical Drawing AI Demo

A standalone Next.js demonstration that analyzes AutoCAD electrical drawings through a Chinese Ant Design X chat workspace.

## What works

- Persistent analysis conversations and messages
- Secure one-file DWG/DXF uploads with extension, size, and file-signature validation
- Prepared DWG demonstration fixture
- Native ASCII DXF parsing without AutoCAD
- Local DWG-to-DXF conversion, GBK/ANSI_936 Chinese decoding, and native CAD BOM extraction
- DXF SVG/PNG rendering and four overlapping analysis tiles
- Server-side OpenAI Responses API vision adapter with strict JSON Schema and Zod validation
- Duplicate consolidation across image tiles
- Chinese categorized component lists, review queue, editing, removal, confirmation, native BOM, and Excel export
- Deterministic natural-language questions for device model counts, quantities, cross-drawing distribution, BOM, and basic consistency review
- Explicit confidence, method, source tile, evidence, and review state for every detected component

Every result is preliminary and requires verification by an electrical engineer.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

Do not place the OpenAI key in browser code or commit it. Add it only to `.env.local`:

```dotenv
OPENAI_API_KEY="your-key"
OPENAI_VISION_MODEL="gpt-5.6-terra"
```

## Demo files

- `fixtures/cad/control-panel-a.dwg` runs the deterministic prepared DWG demonstration.
- `fixtures/cad/synthetic-control-panel.dxf` exercises the real parser, renderer, and OpenAI vision path.

An unfamiliar DWG intentionally fails with a clear message until a real licensed DWG conversion adapter is configured. An unfamiliar DXF is never silently replaced with fixture results.

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke:dxf
npm run smoke:drawing-qa -- /path/to/M-T1-01.dwg /path/to/M-T1-02.dwg
```

`npm run smoke:dxf` makes a live, quota-consuming OpenAI request only when `OPENAI_API_KEY` is configured. `smoke:drawing-qa` uses an isolated temporary database and validates the native CAD path without an OpenAI key.

## Current limitations

- Real analysis supports ASCII DXF and DWG files accepted by the installed `dwg2dxf` converter; binary DXF is not supported.
- Detection is image-based and preliminary; it does not reconstruct full native wire topology or terminal graphs.
- Bounding boxes are approximate and derived from tiled rendering coordinates.
- Deterministic drawing questions use native CAD BOM evidence; unrestricted questions outside the extracted device names remain intentionally unsupported.
- No manufacturer or model value is inferred when it is not visibly present.
