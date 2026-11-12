#!/usr/bin/env bash
# Linux → Windows 交叉打包（NSIS 安装包）。
#
# 2026-11-13 真机事故：用裸 `cargo xwin build --release` 打出来的包没带
# custom-protocol feature，运行时去连 devUrl 127.0.0.1:7351，用户装完就是
# 「嗯… 无法访问此页面 / ERR_CONNECTION_REFUSED」。Tauri CLI 会自动加这个
# feature，裸 cargo 不会。所以下面 --features custom-protocol 一个字都不能删；
# src-tauri/src/lib.rs 里还有一道编译期门禁，漏了会直接编不过。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/3 构建前端 dist"
cd "$ROOT"
pnpm build

echo "==> 2/3 交叉编译 Windows 主程序（必须带 custom-protocol）"
cd "$ROOT/src-tauri"
cargo xwin build --release --target x86_64-pc-windows-msvc --features custom-protocol

echo "==> 3/3 生成 NSIS 安装包"
NSIS_DIR="$ROOT/src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64"
cd "$NSIS_DIR"
makensis installer.nsi

OUT="${INTX_WINDOWS_OUT:-$ROOT/../INTX_0.1.0_x64-setup.exe}"
cp nsis-output.exe "$OUT"
echo "产物：$OUT"
sha256sum "$OUT"
