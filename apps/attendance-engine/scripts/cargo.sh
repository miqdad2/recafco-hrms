#!/usr/bin/env bash
# Cargo wrapper for the attendance engine. Usage (from apps/attendance-engine):
#
#   ./scripts/cargo.sh build | test | clippy --all-targets -- -D warnings | run ...
#
# On Linux / macOS / Windows-MSVC this is a plain pass-through to `cargo`.
#
# On a Windows *GNU* host (the RUST-01 dev machine has no Visual Studio Build Tools), `windows-sys`
# needs an import-library tool. rustup's bundled GNU `dlltool.exe` requires an external assembler
# (`as.exe`) that is not installed, so instead we point rustc at LLVM's dlltool, which needs no
# assembler. rustup's official `llvm-tools` component ships `llvm-ar.exe`, a multi-call binary that
# behaves as `llvm-dlltool` when invoked under that name. The copy lives in the git-ignored
# `target/` directory. Nothing global (PATH, registry, other toolchains) is modified.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cargo >/dev/null 2>&1 && [ -x "$HOME/.cargo/bin/cargo" ]; then
  export PATH="$HOME/.cargo/bin:$PATH" # this process only
fi

host="$(rustc -vV | sed -n 's/^host: //p')"
if [ "$host" = "x86_64-pc-windows-gnu" ]; then
  sysroot="$(rustc --print sysroot)"
  llvm_ar="$sysroot/lib/rustlib/$host/bin/llvm-ar.exe"
  if [ ! -f "$llvm_ar" ]; then
    rustup component add llvm-tools
  fi
  mkdir -p target/tools
  if [ ! -f target/tools/llvm-dlltool.exe ] || ! cmp -s "$llvm_ar" target/tools/llvm-dlltool.exe; then
    cp "$llvm_ar" target/tools/llvm-dlltool.exe
  fi
  dlltool_path="$(pwd -W 2>/dev/null || pwd)/target/tools/llvm-dlltool.exe"
  export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-C dlltool=$dlltool_path"
fi

exec cargo "$@"
