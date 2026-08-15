#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
public_dir="$repo_root/public"
wasm_file="$repo_root/target/wasm32-unknown-unknown/release/minetacs.wasm"

cd "$repo_root"

printf 'Building minetacs.wasm\n'
cargo build --release --target wasm32-unknown-unknown --lib

cp -- "$wasm_file" "$public_dir/minetacs.wasm"

printf 'Finished %s\n' "$public_dir/index.html"
