#!/bin/bash
node_modules/.bin/tsx server/index.ts &
API_PID=$!

node node_modules/vite/bin/vite.js &
VITE_PID=$!

trap "kill $API_PID $VITE_PID 2>/dev/null" EXIT INT TERM

wait
