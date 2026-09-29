#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../../src/main/resources/native/linux-x64
"${ZIG:-zig}" cc -target x86_64-linux-musl -static -O2 -s -Wall -Wextra -Werror \
  neuoj-time.c -o ../../src/main/resources/native/linux-x64/neuoj-time
