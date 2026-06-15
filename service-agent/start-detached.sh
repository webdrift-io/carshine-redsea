#!/bin/bash
# Persistent service agent startup
cd "$(dirname "$0")"
nohup node server.js < /dev/null > service-agent.log 2>&1 &
echo $! > service-agent.pid
echo "Started CarShine Service Agent (PID: $(cat service-agent.pid))"