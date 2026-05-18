#!/bin/bash
# setup.sh — Full setup and test script for haveno-web + Ledger + Tor
#
# Run on x86-64 Linux or macOS with:
#   chmod +x setup.sh && ./setup.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== Haveno-Web + Ledger Nano X + Tor — MVP Setup ==="
echo "  Working directory: $DIR"
echo ""

# ─── Prerequisites check ──────────────────────────────────────────────────
check_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[ERROR] $1 not found. Please install it."; exit 1; }
}

echo "[1/6] Checking prerequisites..."
check_cmd node
check_cmd npm

NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "[ERROR] Node.js >= 18 required (found v$(node --version))"
  exit 1
fi

echo "  Node.js $(node --version) ✓"

# ─── Install dependencies ─────────────────────────────────────────────────
echo ""
echo "[2/6] Installing dependencies (this may take 5-10 minutes)..."

# Use npm for better ARM64 compatibility
npm install 2>&1 | tail -5 || {
  echo "[WARN] Full npm install failed, installing core deps..."
  npm install --ignore-scripts elm vitest @ledgerhq/hw-transport-webusb 2>&1 | tail -3
}

# ─── Verify Elm ───────────────────────────────────────────────────────────
echo ""
echo "[3/6] Verifying Elm compiler..."
if npx elm --version >/dev/null 2>&1; then
  ELM_VER=$(npx elm --version)
  echo "  Elm $ELM_VER ✓"
else
  echo "  [WARN] Elm not available — will try to install from npm"
  npm install --ignore-scripts elm@0.19.1-6 2>&1 | tail -3
  if npx elm --version >/dev/null 2>&1; then
    echo "  Elm installed ✓"
  else
    echo "  [ERROR] Elm 0.19.1 is not available for this architecture (ARM64?)"
    echo "  Please install from https://github.com/elm/compiler/releases"
    echo "  Skipping Elm compilation tests..."
    SKIP_ELM=true
  fi
fi

# ─── Run JS unit tests ────────────────────────────────────────────────────
echo ""
echo "[4/6] Running JavaScript unit tests (vitest)..."
npx vitest run --config vitest.config.ts 2>&1 | tail -20 || echo "[WARN] Some tests failed"

# ─── Compile Elm ──────────────────────────────────────────────────────────
echo ""
echo "[5/6] Compiling Elm application..."
if [ "${SKIP_ELM:-false}" = "true" ]; then
  echo "  Skipping — Elm not available"
else
  # Generate protobuf Elm types if needed
  if [ -d "ProtoRef" ]; then
    echo "  Generating Elm protobuf types..."
    npx protoc --elm_out=src --plugin=protoc-gen-elm="$(which protoc-gen-elm 2>/dev/null || echo 'not found')" \
      ProtoRef/*.proto 2>&1 || echo "  [WARN] Protobuf type generation skipped (protoc not found)"
  fi

  # Compile Elm
  echo "  Compiling src/Main.elm..."
  npx elm make src/Main.elm --output=js/elm.js --optimize 2>&1 | tail -5
  echo "  Elm compilation ✓"
fi

# ─── Run Elm tests ────────────────────────────────────────────────────────
echo ""
echo "[6/6] Running Elm tests..."
if [ "${SKIP_ELM:-false}" = "true" ]; then
  echo "  Skipping — Elm not available"
else
  npx elm-test 2>&1 | tail -20 || echo "[WARN] Some Elm tests failed"
fi

# ─── Summary ──────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "  Created files:"
echo "    js/ledgerMonero.js      — Ledger APDU protocol (WebUSB)"
echo "    js/ledgerElmBridge.js   — Elm ↔ Ledger JS bridge"
echo "    js/torProxy.js          — Tor SOCKS5 + Envoy config"
echo "    Docs/INTEGRATION_GUIDE.md  — Full integration guide"
echo "    bdd/features/ledger.features — BDD acceptance tests"
echo "    envoy.yaml              — Envoy proxy config"
echo "    terminals/startEnvoy.sh — Envoy startup script"
echo "    js/tests/*.test.js      — JS unit tests"
echo ""
echo "  Next steps:"
echo "    1. Start Tor:          tor --SOCKSPort 9050"
echo "    2. Start Envoy:        ./terminals/startEnvoy.sh"
echo "    3. Start dev server:   npx parcel serve"
echo "    4. Connect Ledger:     Open app in Chrome/Edge/Brave"
echo "    5. Click 'Connect Ledger' on the 'Connect' page"
echo ""
echo "  For full documentation:  cat Docs/INTEGRATION_GUIDE.md"
