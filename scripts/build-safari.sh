#!/usr/bin/env bash
# Wraps dist/safari in an Xcode project and builds the macOS app that hosts
# the Safari extension. Needs a full Xcode install, not just Command Line Tools.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
project_dir="$root/dist/safari-xcode"

if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  for app in /Applications/Xcode.app /Applications/Xcode-beta.app; do
    [[ -d "$app" ]] && export DEVELOPER_DIR="$app/Contents/Developer" && break
  done
fi
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Safari builds need Xcode. Install it from the App Store, then run this again." >&2
  exit 1
fi

node "$root/scripts/build.mjs" safari

rm -rf "$project_dir"
xcrun safari-web-extension-converter "$root/dist/safari" \
  --project-location "$project_dir" \
  --app-name Slyfox \
  --bundle-identifier local.slyfox.Slyfox \
  --swift --macos-only --copy-resources --no-open --no-prompt --force

# Unsigned local build: enable Safari > Develop > Allow Unsigned Extensions to load it.
xcodebuild \
  -project "$project_dir/Slyfox/Slyfox.xcodeproj" \
  -scheme Slyfox \
  -configuration Debug \
  -derivedDataPath "$project_dir/build" \
  CODE_SIGNING_ALLOWED=NO \
  build

echo
echo "Built: $project_dir/build/Build/Products/Debug/Slyfox.app"
echo "Open it once, then enable Slyfox in Safari > Settings > Extensions."
