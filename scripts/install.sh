#!/bin/sh
set -eu

BASE_URL="${HT_INSTALL_BASE_URL:-https://cli.hellotracks.org}"
if [ "${1:-}" = "--base-url" ]; then
  BASE_URL="${2:-}"
  shift 2
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) ARTIFACT_PLATFORM="darwin" ;;
  Linux) ARTIFACT_PLATFORM="linux" ;;
  *)
    echo "Unsupported operating system: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARTIFACT_ARCH="arm64" ;;
  x86_64|amd64) ARTIFACT_ARCH="x64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Hellotracks CLI." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to read the release manifest." >&2
  exit 1
fi

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/ht-install.XXXXXX")"
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT INT TERM

MANIFEST_URL="${BASE_URL%/}/manifest.json"
curl -fsSL "$MANIFEST_URL" -o "$TMPDIR/manifest.json"

VERSION="$(python3 - <<'PY' "$TMPDIR/manifest.json"
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh)["version"])
PY
)"

ARTIFACT_FILE="$(python3 - <<'PY' "$TMPDIR/manifest.json" "$ARTIFACT_PLATFORM" "$ARTIFACT_ARCH"
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
platform = sys.argv[2]
arch = sys.argv[3]
for item in data.get("artifacts", []):
    if item.get("platform") == platform and item.get("arch") == arch:
        print(item["file"])
        raise SystemExit(0)
raise SystemExit(1)
PY
)"

ARTIFACT_SHA256="$(python3 - <<'PY' "$TMPDIR/manifest.json" "$ARTIFACT_PLATFORM" "$ARTIFACT_ARCH"
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
platform = sys.argv[2]
arch = sys.argv[3]
for item in data.get("artifacts", []):
    if item.get("platform") == platform and item.get("arch") == arch:
        print(item.get("sha256", ""))
        raise SystemExit(0)
raise SystemExit(1)
PY
)"

INSTALL_ROOT="$HOME/.hellotracks/ht-cli"
VERSION_ROOT="$INSTALL_ROOT/$VERSION"
CURRENT_ROOT="$INSTALL_ROOT/current"
LOCAL_BIN="$HOME/.local/bin"
LAUNCHER="$LOCAL_BIN/ht"

mkdir -p "$INSTALL_ROOT" "$LOCAL_BIN"

ARTIFACT_PATH="$TMPDIR/$ARTIFACT_FILE"
mkdir -p "$(dirname "$ARTIFACT_PATH")"
curl -fsSL "${BASE_URL%/}/$ARTIFACT_FILE" -o "$ARTIFACT_PATH"

if [ -n "$ARTIFACT_SHA256" ]; then
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
  else
    echo "Could not verify checksum because neither shasum nor sha256sum is available." >&2
    exit 1
  fi
  if [ "$ACTUAL_SHA256" != "$ARTIFACT_SHA256" ]; then
    echo "Checksum verification failed for $ARTIFACT_FILE" >&2
    echo "Expected: $ARTIFACT_SHA256" >&2
    echo "Actual:   $ACTUAL_SHA256" >&2
    exit 1
  fi
fi

rm -rf "$VERSION_ROOT"
mkdir -p "$VERSION_ROOT"
tar -xzf "$ARTIFACT_PATH" -C "$VERSION_ROOT" --strip-components=1

if [ "$ARTIFACT_PLATFORM" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$VERSION_ROOT" >/dev/null 2>&1 || true
fi

ln -sfn "$VERSION_ROOT" "$CURRENT_ROOT"
ln -sfn "$CURRENT_ROOT/bin/ht" "$LAUNCHER"

ZPROFILE="$HOME/.zprofile"
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
if [ ! -f "$ZPROFILE" ] || ! grep -F "$PATH_LINE" "$ZPROFILE" >/dev/null 2>&1; then
  printf '\n%s\n' "$PATH_LINE" >> "$ZPROFILE"
fi

echo "Installed Hellotracks CLI $VERSION"
echo "Launcher: $LAUNCHER"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) PATH_ACTIVE="yes" ;;
  *) PATH_ACTIVE="no" ;;
esac

if [ "$PATH_ACTIVE" = "no" ]; then
  echo "Your current shell does not yet include ~/.local/bin on PATH."
  echo "You can run the CLI immediately with:"
  echo "  $LAUNCHER"
  echo "Or open a new terminal window afterwards."
fi

echo "Next steps:"
echo "  ht auth login"
echo "  ht"
