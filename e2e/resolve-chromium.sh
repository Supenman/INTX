#!/usr/bin/env bash
# 找一个确实能启动的系统 Chromium / Chrome，把绝对路径打到 stdout。
#
#   CHROMIUM_PATH="$(bash e2e/resolve-chromium.sh)" pnpm e2e
#
# helpers.mjs 优先读 CHROMIUM_PATH；不设时它自己按下面这份**同样的**候选列表
# 探测（顺序由 src/infra/ci/workflow.test.ts 对账，别只改一处）。
#
# 为什么要跑一次 --version：Ubuntu 24.04 上的 chromium-browser 是 snap 转接
# 脚本，文件存在、有执行位，但 Playwright 根本起不来。只判断 -x 会挑中它，
# 然后 E2E 以一种很难看懂的方式失败。

set -euo pipefail

CANDIDATES=(
  /usr/bin/google-chrome-stable
  /usr/bin/google-chrome
  /usr/bin/chromium
  /usr/bin/chromium-browser
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

for p in "${CANDIDATES[@]}"; do
  if [ -x "$p" ] && "$p" --version >/dev/null 2>&1; then
    echo "$p"
    exit 0
  fi
done

echo "没有找到可用的系统 Chromium / Chrome；可用 CHROMIUM_PATH=/path/to/chrome 显式指定。" >&2
exit 1
