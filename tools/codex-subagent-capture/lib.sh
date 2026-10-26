# Shared setup for the Codex capture tools. Sourced by run and by codex-worker-claims/run.

# A private CODEX_HOME at OUT/home holding only a copy of auth.json, OUT/log, OUT/hook.sh.
capture_home() {
  local out=$1 auth=${CODEX_AUTH:-$HOME/.codex/auth.json}
  [[ -r $auth ]] || { echo "no readable Codex auth at $auth" >&2; return 2; }
  mkdir -p "$out/home" "$out/log"
  install -m 600 "$auth" "$out/home/auth.json"
  cat >"$out/hook.sh" <<'HOOK'
#!/usr/bin/env bash
# Records each hook as JSON: payload, CODEX_* env and /proc ancestry. Given a third argument,
# it wraps that hook command: the payload is piped to it first, then the relay registry (and
# tasks' claims, when CAPTURE_CLAIMS is set) is copied, and the command's reply and exit
# code are passed through. Each copy is therefore the state that event left.
event=$1 log=$2 wrapped=${3:-}
exec 3>&2 2>>"$log/hook.stderr"
seq=$(date +%s%N)
payload=$(cat)
rc=0
if [[ -n $wrapped ]]; then
  printf '%s' "$payload" | sh -c "$wrapped" >"$log/$seq-$event.reply" 2>"$log/$seq-$event.reply-stderr" || rc=$?
  [[ -n ${RELAY_STATE_DIR:-} && -r $RELAY_STATE_DIR/agents.json ]] && cp "$RELAY_STATE_DIR/agents.json" "$log/$seq-$event.agents.json"
  [[ -n ${CAPTURE_CLAIMS:-} ]] && tasks claims >"$log/$seq-$event.claims.json"
fi
chain='[' pid=$$ sep=
while [[ $pid -gt 1 && -r /proc/$pid/stat ]]; do
  stat=$(</proc/$pid/stat)
  comm=${stat#*(} comm=${comm%)*}
  rest=${stat##*) } ppid=$(cut -d' ' -f2 <<<"$rest")
  argv0=$(tr '\0' '\n' </proc/$pid/cmdline | head -1)
  chain+="$sep{\"pid\":$pid,\"ppid\":$ppid,\"comm\":$(jq -Rn --arg v "$comm" '$v'),\"argv0\":$(jq -Rn --arg v "$argv0" '$v')}"
  sep=, pid=$ppid
done
chain+=']'
# Every CODEX_* name is kept, but only the ids and CODEX_HOME keep their values: any other
# variable (CODEX_API_KEY) may be a credential.
env_json=$(env | grep '^CODEX_' | jq -Rn '[inputs | capture("^(?<key>[^=]+)=(?<value>.*)$")
  | if (.key | IN("CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_HOME")) then . else .value = "<redacted>" end] | from_entries')
jq -n --arg event "$event" --argjson payload "$payload" --argjson env "$env_json" --argjson ancestry "$chain" \
  '{event: $event, payload: $payload, env: $env, ancestry: $ancestry}' >"$log/$seq-$event.json"
if [[ -n $wrapped ]]; then
  cat "$log/$seq-$event.reply"; cat "$log/$seq-$event.reply-stderr" >&3
  exit "$rc"
fi
# A failing logger must not block the run: Codex reads exit 2 as a refusal.
exit 0
HOOK
  chmod 700 "$out/hook.sh"
}

scrub_auth() { rm -f "$1/home/auth.json"; }

# The first record of EVENT whose payload matches the jq condition, or failure.
logged() {
  local f
  for f in "$out"/log/*-"$1".json; do [[ -e $f ]] && jq -e ".payload | $2" "$f" >/dev/null && { echo "$f"; return 0; }; done
  return 1
}

switch_ready() {
  local root_json
  root_json=$(jq -Rn --arg root "$1" '$root')
  logged Stop ".session_id == $root_json and .agent_id == null" >/dev/null &&
    logged PreToolUse ".session_id == $root_json and .agent_id != null" >/dev/null
}

CAPTURE_EVENTS=(SessionStart SubagentStart UserPromptSubmit PreToolUse PostToolUse PermissionRequest Stop SubagentStop SessionEnd)

# The logging hook alone, on every event.
plain_hooks() {
  local out=$1
  jq -n --arg hook "$out/hook.sh" --arg log "$out/log" '
    {hooks: ($ARGS.positional | map({key: ., value: [{hooks: [{type: "command",
      command: "\($hook | @sh) \(. | @sh) \($log | @sh)", timeout: 30}]}]}) | from_entries)}' \
    --args "${CAPTURE_EVENTS[@]}" >"$out/home/hooks.json"
}

# Relay's own hooks, from relay install, into OUT/home/hooks.json; private state and config.
install_relay() {
  local out=$1 relay=$2
  mkdir -p "$out/relay-config" "$out/relay-state" && chmod 700 "$out/relay-config" "$out/relay-state"
  printf '{"schema":1,"subscribers":[]}\n' >"$out/relay-config/subscribers.json"
  chmod 600 "$out/relay-config/subscribers.json"
  printf '{"hooks":{}}\n' >"$out/home/hooks.json"
  node "$relay" install --harness codex --subscribers "$out/relay-config/subscribers.json" \
    --target "$out/home/hooks.json" --artifact "$out/relay-install.json" --apply >"$out/relay-install.out"
}

# Run every relay hook inside the logging hook, and log PostToolUse, which relay does not bind.
wrap_relay() {
  local out=$1 tmp
  tmp=$(mktemp)
  jq --arg hook "$out/hook.sh" --arg log "$out/log" '
    .hooks |= with_entries(.key as $e | .value |= map(.hooks |= map(.command =
      "\($hook | @sh) \($e | @sh) \($log | @sh) \(.command | @sh)")))
    | .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [{hooks: [{type: "command",
      command: "\($hook | @sh) PostToolUse \($log | @sh)", timeout: 30}]}])' \
    <"$out/home/hooks.json" >"$tmp" && mv "$tmp" "$out/home/hooks.json"
}
