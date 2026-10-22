#!/bin/bash
set -u
ROOT='/Library/Application Support/BKQL Connect/Service.app/Contents'
export ELECTRON_RUN_AS_NODE=1
if [[ -x "$ROOT/MacOS/USTB Connect" ]]; then
  "$ROOT/MacOS/USTB Connect" "$ROOT/Resources/app/src/stop.cjs"
else
  printf '此电脑尚未安装系统后台。\n'
fi
printf '\n按回车关闭。'
read -r _answer
