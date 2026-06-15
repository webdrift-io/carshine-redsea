#!/bin/bash
# CarShine Red Sea - Production Server Starter (Unix/Linux/WSL)
# Starts both services fully detached from terminal

set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  CarShine Red Sea - Starting Services"
echo "=========================================="
echo

# Kill any existing instances
echo "Cleaning up any existing processes..."
fuser -k 5000/tcp 2>/dev/null || true
fuser -k 4173/tcp 2>/dev/null || true
sleep 1

# Start Service Agent on port 5000 (fully detached)
echo "[1/2] Starting Service Agent (port 5000)..."
nohup node service-agent/server.js < /dev/null > service-agent.log 2>&1 &
echo $! > service-agent.pid
disown

# Start Landing Page on port 4173 (fully detached)
echo "[2/2] Starting Landing Page (port 4173)..."
nohup node serve-landing.cjs < /dev/null > landing.log 2>&1 &
echo $! > landing.pid
disown

echo
echo "Waiting for servers to start..."
sleep 5

echo
echo "=========================================="
echo "  Status Check"
echo "=========================================="
echo

if ss -tlnp 2>/dev/null | grep -q ":5000"; then
    echo "  Service Agent (5000): RUNNING (PID: $(cat service-agent.pid))"
else
    echo "  Service Agent (5000): FAILED - check service-agent.log"
fi

if ss -tlnp 2>/dev/null | grep -q ":4173"; then
    echo "  Landing Page (4173): RUNNING (PID: $(cat landing.pid))"
else
    echo "  Landing Page (4173): FAILED - check landing.log"
fi

echo
echo "=========================================="
echo "  Open These URLs in Your Browser"
echo "=========================================="
echo
echo "  Service Agent:  http://localhost:5000"
echo "  Admin Login:    http://localhost:5000/login"
echo "  API Docs:       http://localhost:5000/api-docs/"
echo "  Chatbot Demo:   http://localhost:5000/chatbot-demo.html"
echo "  Health Check:   http://localhost:5000/health"
echo
echo "  Landing Page:   http://localhost:4173/"
echo "  Arabic:         http://localhost:4173/ar/"
echo "  German:         http://localhost:4173/de/"
echo
echo "=========================================="
echo "  Login Credentials"
echo "=========================================="
echo
echo "  Email:    admin@carshineredsea.com"
echo "  Password: ChangeMe123!"
echo
echo "=========================================="