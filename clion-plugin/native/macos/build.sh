#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../../src/main/resources/native/macos
clang -O2 -Wall -Wextra -Werror -arch arm64 -arch x86_64 \
  -mmacosx-version-min=11.0 neuoj-time.c \
  -o ../../src/main/resources/native/macos/neuoj-time
archs="$(lipo -archs ../../src/main/resources/native/macos/neuoj-time)"
case " $archs " in *" arm64 "*) ;; *) exit 1 ;; esac
case " $archs " in *" x86_64 "*) ;; *) exit 1 ;; esac
