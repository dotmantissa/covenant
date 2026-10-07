#!/usr/bin/env bash
# Runs the genlayer CLI with the keystore password supplied on stdin.
#
# The CLI prompts for the password on every command that signs or reads a
# receipt, and this machine has no OS keychain, so `genlayer account unlock`
# cannot cache the key. Piping the prompt keeps deploys non-interactive.
#
# The password is read from .env.local and never appears in argv, so it stays
# out of `ps` output. Anything the CLI echoes back is filtered through perl,
# which takes the pattern from the environment for the same reason.
set -uo pipefail

cd "$(dirname "$0")/.."
set -a
. ./.env.local
set +a

printf '%s\n' "$COVENANT_KEYSTORE_PASSWORD" \
  | genlayer "$@" 2>&1 \
  | perl -pe 'BEGIN { $p = $ENV{COVENANT_KEYSTORE_PASSWORD} } s/\Q$p\E/<redacted>/g'

exit "${PIPESTATUS[1]}"
