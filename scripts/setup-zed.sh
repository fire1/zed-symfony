#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${HOME}/.local/share/zed/extensions/work/symfony-fire1"
BUNDLE="${ROOT}/symfony-lsp/dist/server.bundle.js"

echo "Building Symfony LSP..."
npm run build --prefix "${ROOT}/symfony-lsp"

if [[ ! -f "${BUNDLE}" ]]; then
  echo "Error: bundle not found at ${BUNDLE}" >&2
  exit 1
fi

mkdir -p "${WORK_DIR}"
cp "${BUNDLE}" "${WORK_DIR}/symfony-lsp-server.js"
echo "Installed LSP to ${WORK_DIR}/symfony-lsp-server.js"

if command -v cargo >/dev/null 2>&1; then
  echo "Building Zed WASM extension..."
  rustup target add wasm32-wasip2 >/dev/null 2>&1 || true
  cargo build --target wasm32-wasip2 --release --manifest-path "${ROOT}/Cargo.toml"
  echo "WASM built."
fi

echo ""
echo "Done. Restart Zed, then check language server logs for 'symfony-lsp'."
