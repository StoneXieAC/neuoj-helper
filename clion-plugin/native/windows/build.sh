#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../../src/main/resources/native/windows-x64
"${ZIG:-zig}" cc -target x86_64-windows-gnu -municode -O2 -s -Wall -Wextra -Werror \
  neuoj-time.c -o ../../src/main/resources/native/windows-x64/neuoj-time.exe
rm -f ../../src/main/resources/native/windows-x64/neuoj-time.pdb
