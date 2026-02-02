#!/bin/bash

# Breeze Proxy Startup Script
# Automatically finds an available port and starts the server

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                              ║"
echo "║                      Breeze Proxy - Smart Startup                           ║"
echo "║                                                                              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Function to check if port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 1  # Port is in use
    else
        return 0  # Port is free
    fi
}

# Try ports in order: 8081, 8082, 8083, 9000, 9001
PORTS=(8081 8082 8083 9000 9001)
SELECTED_PORT=""

echo "🔍 Finding available port..."
echo ""

for port in "${PORTS[@]}"; do
    if check_port $port; then
        SELECTED_PORT=$port
        echo "✅ Port $port is available"
        break
    else
        echo "❌ Port $port is in use (likely Jupyter or another service)"
    fi
done

if [ -z "$SELECTED_PORT" ]; then
    echo ""
    echo "❌ ERROR: No available ports found!"
    echo "   Tried ports: ${PORTS[@]}"
    echo ""
    echo "   Solutions:"
    echo "   1. Kill processes: for p in ${PORTS[@]}; do lsof -ti:\$p | xargs kill -9 2>/dev/null; done"
    echo "   2. Manually specify port: PORT=9999 python breeze_proxy_app.py"
    echo ""
    exit 1
fi

echo ""
echo "🚀 Starting Breeze Proxy on port $SELECTED_PORT..."
echo ""

# Set the PORT environment variable and start the server
export PORT=$SELECTED_PORT
python3 breeze_proxy_app.py
