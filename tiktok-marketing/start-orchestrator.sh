#!/bin/bash
# Multi-Platform Marketing Orchestrator - Unix Service Script
#
# Usage:
#   ./start-orchestrator.sh           # Start in scheduled mode
#   ./start-orchestrator.sh validate  # Just validate config
#   ./start-orchestrator.sh pipeline  # Run pipeline once
#   ./start-orchestrator.sh analytics # Pull analytics
#
# Add to crontab for automatic startup:
#   @reboot /path/to/tiktok-marketing/start-orchestrator.sh schedule >> /path/to/tiktok-marketing/logs/cron.log 2>&1

set -e
cd "$(dirname "$0")"

case "${1:-schedule}" in
  validate)
    node orchestrator.js --validate
    ;;
  pipeline)
    node orchestrator.js --pipeline
    ;;
  analytics)
    node orchestrator.js --analytics
    ;;
  schedule)
    echo "[$(date)] Starting Multi-Platform Orchestrator in scheduled mode..."
    exec node orchestrator.js --schedule
    ;;
  test-alert)
    node orchestrator.js --test-alert
    ;;
  *)
    echo "Usage: $0 {validate|pipeline|analytics|schedule|test-alert}"
    exit 1
    ;;
esac