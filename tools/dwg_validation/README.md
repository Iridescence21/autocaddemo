# DWG validation harness

This isolated Python harness proves real DWG conversion, native DXF evidence
extraction, and image rendering before the application is changed.

```bash
brew install libredwg

PY=/Users/ljp/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
$PY -m venv .venv-dwg-validation
.venv-dwg-validation/bin/python -m pip install --upgrade pip
.venv-dwg-validation/bin/python -m pip install -r tools/dwg_validation/requirements.txt
.venv-dwg-validation/bin/python -m unittest tools.dwg_validation.test_validate_dwg -v
```

Real-file gate:

```bash
.venv-dwg-validation/bin/python -m tools.dwg_validation.validate_dwg \
  --converter "$(command -v dwg2dxf)" \
  --output .artifacts/dwg-validation \
  --required-term M-T1-02=M-T1-02,TA1,KA1,YCT1 \
  '/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-01.dwg' \
  '/Users/ljp/Documents/10KV高压配电柜一二次系统原理/35-6~10KV变压器二次电路图/M-T1-02.dwg'
```
