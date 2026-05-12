# Revert: n8n "Migration | Supabase handler" decimal-dimension fix

**Workflow id:** `L17WMUB4Ku5zmwre`
**Applied:** 2026-05-12 (server `updatedAt`: 2026-05-12T15:08:44.386Z)
**Backup of pre-patch state:** `L17WMUB4Ku5zmwre-2026-05-12-pre-decimal-fix.json` (in this folder; gitignored — contains n8n credentials and `pinData` PII, kept local-only)

## What changed

In three code nodes — `Properties per Line item (EDITING OG)`, `Properties per Line item (EDITING KH)`, `Properties per Line item (EDITING VI) - dupe of KH` — the `extractNumber` helper and the "Division Dimensions" Left/Right regexes were changed to accept decimals:

- `/(\d+)/` + `parseInt` → `/(\d+(?:\.\d+)?)/` + `parseFloat`
- `/Left\s+(\d+)cm/i` → `/Left\s+(\d+(?:\.\d+)?)cm/i` (same for `Right`)
- `parseInt(leftMatch[1])` / `parseInt(rightMatch[1])` → `parseFloat(...)`

Purpose: stop truncating customer inputs like `130.5cm` → `130cm` (i.e. `1305mm` → `1300mm`) when writing `finishedHeightInMm` / `finishedWidthLeftInMm` / `finishedWidthRightInMm` to Supabase.

## Quick revert

Run from the repo root. Requires `N8N_API_URL` and `N8N_API_KEY` from `.env`.

```sh
set -a && source .env && set +a

# Strip read-only / non-public-API fields, then PUT the backup back.
python3 - <<'PY'
import json
with open('n8n-backups/L17WMUB4Ku5zmwre-2026-05-12-pre-decimal-fix.json') as f:
    wf = json.load(f)
ALLOWED = {'saveExecutionProgress','saveManualExecutions','saveDataErrorExecution',
           'saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'}
payload = {
    'name': wf['name'],
    'nodes': wf['nodes'],
    'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
if wf.get('staticData') is not None:
    payload['staticData'] = wf['staticData']
open('/tmp/n8n_revert_payload.json','w').write(json.dumps(payload, ensure_ascii=False))
PY

curl -sS -w '\nHTTP %{http_code}\n' \
  -X PUT "$N8N_API_URL/api/v1/workflows/L17WMUB4Ku5zmwre" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  --data @/tmp/n8n_revert_payload.json | tail -1
```

Expect `HTTP 200`. The workflow stays active across the PUT — no re-activation needed.

## Verify after revert

```sh
curl -s "$N8N_API_URL/api/v1/workflows/L17WMUB4Ku5zmwre" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
| python3 -c "
import json, sys
wf = json.load(sys.stdin)
for n in wf['nodes']:
    if 'Properties per Line item' in n['name']:
        code = n['parameters']['jsCode']
        ok = 'const match = str.match(/(\\\\d+)/);' in code and 'parseInt(match[1])' in code
        print(n['name'], '->', 'reverted' if ok else 'STILL PATCHED')
"
```

All three nodes should print `reverted`.

## Manual UI fallback

If the API is unavailable, in the n8n UI for workflow `L17WMUB4Ku5zmwre`, open each of the three nodes and replace:

| New (patched) | Old (revert to) |
|---|---|
| `str.match(/(\d+(?:\.\d+)?)/)` | `str.match(/(\d+)/)` |
| `parseFloat(match[1])` (inside `extractNumber`) | `parseInt(match[1])` |
| `/Left\s+(\d+(?:\.\d+)?)cm/i` | `/Left\s+(\d+)cm/i` |
| `/Right\s+(\d+(?:\.\d+)?)cm/i` | `/Right\s+(\d+)cm/i` |
| `parseFloat(leftMatch[1])` | `parseInt(leftMatch[1])` |
| `parseFloat(rightMatch[1])` | `parseInt(rightMatch[1])` |
