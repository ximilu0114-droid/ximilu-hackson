#!/usr/bin/env bash
# Reset agent state for a clean demo recording: start scanning from the
# current attested height so only NEW payments appear on the dashboard.
set -euo pipefail
cd "$(dirname "$0")/.."

H=$(curl -s "https://prover.cc3-testnet.creditcoin.network/api/v1/attested-height/1" |
  python3 -c "import json,sys;print(json.load(sys.stdin)['attestedHeight'])")

python3 - "$H" <<'EOF'
import json, sys
s = json.load(open('agent/state.json'))
s['lastHeight'] = int(sys.argv[1]); s['events'] = []; s['settledTx'] = {}; s['deliveries'] = {}
json.dump(s, open('agent/state.json', 'w'), indent=2)
print('demo state reset — scanning from attested height', sys.argv[1])
EOF
