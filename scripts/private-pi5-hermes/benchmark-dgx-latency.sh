#!/usr/bin/env bash
# Run on private Pi5 as hermes user (sources ~/.hermes/.env).
set -euo pipefail
source "${HOME}/.hermes/.env"
BASE="${DGX_BASE_URL:-http://100.118.82.72:38081}/v1/chat/completions"
AUTH="Authorization: Bearer ${OPENAI_API_KEY}"

run_test() {
  local label="$1"
  local payload="$2"
  echo "=== ${label} ==="
  start=$(date +%s.%N)
  curl -sf "${BASE}" \
    -H "${AUTH}" -H 'Content-Type: application/json' \
    -d "${payload}" -o /tmp/hermes-lat-test.json
  end=$(date +%s.%N)
  python3 -c "print('elapsed_sec', round(${end} - ${start}, 3))"
  python3 -c "
import json
d=json.load(open('/tmp/hermes-lat-test.json'))
c=d.get('choices',[{}])[0].get('message',{})
print('content_len', len(c.get('content') or ''), 'has_reasoning', bool(c.get('reasoning_content') or c.get('reasoning')))
"
}

run_test 'minimal_1+1' '{"model":"system-prod-primary","messages":[{"role":"user","content":"1+1=?"}],"max_tokens":32,"reasoning_effort":"none"}'
run_test 'short_greeting' '{"model":"system-prod-primary","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"こんにちは"}],"max_tokens":128,"reasoning_effort":"none"}'

SYS=$(python3 -c 'print("You are Hermes, a helpful assistant. " * 120)')
run_test 'large_system_2k' "$(python3 -c "import json; print(json.dumps({'model':'system-prod-primary','messages':[{'role':'system','content':'''${SYS}'''},{'role':'user','content':'今日は何をしましょうか？'}],'max_tokens':256,'reasoning_effort':'none'}))")"
run_test 'no_reasoning_effort_field' '{"model":"system-prod-primary","messages":[{"role":"user","content":"こんにちは"}],"max_tokens":128}'
