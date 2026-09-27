#!/usr/bin/env bash
# Assemble the demo reel from the rendered scene stills (frames/*.png), with cross-fades.
set -euo pipefail
cd "$(dirname "$0")"
SCENES=(00-open:4 01-problem:5 02-views:6 03-seal:6 04-settle:7 05-attacks:6 06-audit:7 07-tests:5 08-close:5)
F=0.6
inputs=(); filt=""; off=0; prev="0:v"
for i in "${!SCENES[@]}"; do
  n="${SCENES[$i]%%:*}"; d="${SCENES[$i]##*:}"
  inputs+=(-loop 1 -t "$d" -i "frames/$n.png")
  if [ "$i" -gt 0 ]; then
    off=$(python3 -c "print(round($off + ${SCENES[$((i-1))]##*:} - $F, 2))")
    filt+="[$prev][$i:v]xfade=transition=fade:duration=$F:offset=$off[v$i];"; prev="v$i"
  fi
done
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "${filt}[$prev]format=yuv420p,fps=30[out]" -map "[out]" \
  -c:v libx264 -preset slow -crf 22 -movflags +faststart ../docs/kirogi-midnight-demo.mp4
