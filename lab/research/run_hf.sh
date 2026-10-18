#!/bin/bash
# usage: run_hf.sh <min trades/day> <max trades/day> <tag>
cd /home/claude/btc
export MINDAY=$1 MAXDAY=$2
tag=$3
(for f in mr flow tpull; do node --max-old-space-size=3000 hf_search.js $f 4000 hf_${tag}_$f.json > hf_${tag}_$f.log 2>&1; done) &
(for f in grid flowfade; do node --max-old-space-size=3000 hf_search.js $f 4000 hf_${tag}_$f.json > hf_${tag}_$f.log 2>&1; done) &
wait
echo "band $MINDAY-$MAXDAY done"
