#!/bin/bash

set -euo pipefail

declare -A env_map=()

extract_env_vars() {
  grep -o '[A-Z_]\+:' worker-configuration.d.ts | sed 's/://'
}

should_forward_runtime_env() {
  local name="$1"

  [[ "$name" =~ ^BOLT_ ]] || [[ "$name" == "AUTH_SECRET" ]] || [[ "$name" =~ ^VITE_PUBLIC_ ]]
}

load_env_file() {
  local file="$1"

  [ -f "$file" ] || return 0

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    local line="${raw_line%$'\r'}"

    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      continue
    fi

    local name="${line%%=*}"
    local value="${line#*=}"

    if [[ "$value" =~ ^\".*\"$ ]]; then
      value="${value:1:-1}"
    fi

    env_map["$name"]="$value"
  done < "$file"
}

build_bindings() {
  local -a bindings=()
  local -a env_vars=()

  load_env_file ".env"
  load_env_file ".env.local"

  mapfile -t env_vars < <(extract_env_vars)

  for var in "${env_vars[@]}"; do
    if [ -n "${!var-}" ] && [ -z "${env_map[$var]+x}" ]; then
      env_map["$var"]="${!var}"
    fi
  done

  while IFS='=' read -r name _; do
    if should_forward_runtime_env "$name" && [ -n "${!name-}" ] && [ -z "${env_map[$name]+x}" ]; then
      env_map["$name"]="${!name}"
    fi
  done < <(env)

  for name in "${!env_map[@]}"; do
    bindings+=("--binding" "${name}=${env_map[$name]}")
  done

  printf '%s\n' "${bindings[@]}"
}

if [ "$#" -gt 0 ]; then
  mapfile -t binding_args < <(build_bindings)
  exec "$@" "${binding_args[@]}"
else
  build_bindings
fi
