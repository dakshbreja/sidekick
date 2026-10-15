#!/bin/zsh
# Start the disposable community demo on this Mac. No provider access or deployment.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required")'
if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts --include=dev --include=optional
fi
print 'School Bridge Community local demo: http://127.0.0.1:8766'
print 'Synthetic data only. Keep this terminal open; Control-C stops and discards the demo.'
exec npm run demo
