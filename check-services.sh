#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================"
echo "Market Intelligence App Status"
echo "================================"
echo ""

# Check if running in VM
echo "📍 Location Check:"
HOSTNAME=$(hostname)
INTERNAL_IP=$(hostname -I | awk '{print $1}')
echo "   Hostname: $HOSTNAME"
echo "   Internal IP: $INTERNAL_IP"
echo ""

# Get external IP
echo "🌐 Getting external IP..."
EXTERNAL_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "Unable to detect")
echo "   External IP: $EXTERNAL_IP"
echo ""

echo "================================"
echo "Service Status"
echo "================================"
echo ""

# Check Backend
echo "1️⃣  Backend (Port 5000)"
if netstat -tuln 2>/dev/null | grep -q ':5000' || ss -tuln 2>/dev/null | grep -q ':5000'; then
    echo -e "   ${GREEN}✅ Backend is RUNNING${NC}"
    PID=$(lsof -ti:5000 2>/dev/null || fuser 5000/tcp 2>/dev/null | awk '{print $1}')
    if [ ! -z "$PID" ]; then
        echo "   Process ID: $PID"
    fi
else
    echo -e "   ${RED}❌ Backend is NOT running${NC}"
    echo "   📝 Start command:"
    echo "      cd ~/Market-Intelligence-Testing && python app.py"
fi
echo ""

# Check Breeze Proxy
echo "2️⃣  Breeze Proxy (Port 8081)"
if netstat -tuln 2>/dev/null | grep -q ':8081' || ss -tuln 2>/dev/null | grep -q ':8081'; then
    echo -e "   ${GREEN}✅ Breeze Proxy is RUNNING${NC}"
    PID=$(lsof -ti:8081 2>/dev/null || fuser 8081/tcp 2>/dev/null | awk '{print $1}')
    if [ ! -z "$PID" ]; then
        echo "   Process ID: $PID"
    fi
else
    echo -e "   ${RED}❌ Breeze Proxy is NOT running${NC}"
    echo "   📝 Start command:"
    echo "      cd ~/Market-Intelligence-Testing/breeze-proxy && python breeze_proxy_app.py"
fi
echo ""

# Check Frontend
echo "3️⃣  Frontend (Port 8082 or 8080)"
FRONTEND_PORT=""
if netstat -tuln 2>/dev/null | grep -q ':8082' || ss -tuln 2>/dev/null | grep -q ':8082'; then
    echo -e "   ${GREEN}✅ Frontend is RUNNING on port 8082${NC}"
    FRONTEND_PORT="8082"
    PID=$(lsof -ti:8082 2>/dev/null || fuser 8082/tcp 2>/dev/null | awk '{print $1}')
    if [ ! -z "$PID" ]; then
        echo "   Process ID: $PID"
    fi
elif netstat -tuln 2>/dev/null | grep -q ':8080' || ss -tuln 2>/dev/null | grep -q ':8080'; then
    echo -e "   ${YELLOW}⚠️  Frontend is RUNNING on port 8080 (expected 8082)${NC}"
    FRONTEND_PORT="8080"
    PID=$(lsof -ti:8080 2>/dev/null || fuser 8080/tcp 2>/dev/null | awk '{print $1}')
    if [ ! -z "$PID" ]; then
        echo "   Process ID: $PID"
    fi
else
    echo -e "   ${RED}❌ Frontend is NOT running${NC}"
    echo "   📝 Start command:"
    echo "      cd ~/Market-Intelligence-Testing/frontend"
    echo "      export VITE_API_URL=http://$EXTERNAL_IP:5000"
    echo "      npm start"
fi
echo ""

echo "================================"
echo "Summary"
echo "================================"
echo ""

# Count running services
RUNNING=0
if netstat -tuln 2>/dev/null | grep -q ':5000' || ss -tuln 2>/dev/null | grep -q ':5000'; then
    RUNNING=$((RUNNING+1))
fi
if netstat -tuln 2>/dev/null | grep -q ':8081' || ss -tuln 2>/dev/null | grep -q ':8081'; then
    RUNNING=$((RUNNING+1))
fi
if netstat -tuln 2>/dev/null | grep -q ':8082' || ss -tuln 2>/dev/null | grep -q ':8080' || ss -tuln 2>/dev/null | grep -q ':8082'; then
    RUNNING=$((RUNNING+1))
fi

echo "Services running: $RUNNING / 3"
echo ""

if [ $RUNNING -eq 3 ]; then
    echo -e "${GREEN}✅ All services are running!${NC}"
    echo ""
    echo "Access your application:"
    if [ ! -z "$FRONTEND_PORT" ]; then
        echo "   🌐 http://$EXTERNAL_IP:$FRONTEND_PORT/"
    else
        echo "   🌐 http://$EXTERNAL_IP:8082/"
    fi
else
    echo -e "${RED}⚠️  Not all services are running!${NC}"
    echo ""
    echo "Missing services:"
    if ! (netstat -tuln 2>/dev/null | grep -q ':5000' || ss -tuln 2>/dev/null | grep -q ':5000'); then
        echo "   ❌ Backend (port 5000)"
    fi
    if ! (netstat -tuln 2>/dev/null | grep -q ':8081' || ss -tuln 2>/dev/null | grep -q ':8081'); then
        echo "   ❌ Breeze Proxy (port 8081)"
    fi
    if ! (netstat -tuln 2>/dev/null | grep -q ':8082' || ss -tuln 2>/dev/null | grep -q ':8080' || ss -tuln 2>/dev/null | grep -q ':8082'); then
        echo "   ❌ Frontend (port 8082/8080)"
    fi
fi

echo ""
echo "================================"
echo "Connectivity Test URLs"
echo "================================"
echo ""
echo "Use these URLs from your laptop/browser:"
echo ""
if [ ! -z "$FRONTEND_PORT" ]; then
    echo "  Frontend:      http://$EXTERNAL_IP:$FRONTEND_PORT/"
else
    echo "  Frontend:      http://$EXTERNAL_IP:8082/"
fi
echo "  Backend API:   http://$EXTERNAL_IP:5000/api/market/nifty-realtime"
echo "  Breeze Proxy:  http://$EXTERNAL_IP:8081/"
echo ""

echo "================================"
echo "Quick Tests (from VM)"
echo "================================"
echo ""

# Test localhost connectivity
echo "Testing localhost connectivity..."
echo ""

echo "Backend (5000):"
if curl -s --max-time 2 http://localhost:5000/api/market/nifty-realtime >/dev/null 2>&1; then
    echo -e "  ${GREEN}✅ Backend responding${NC}"
else
    if netstat -tuln 2>/dev/null | grep -q ':5000' || ss -tuln 2>/dev/null | grep -q ':5000'; then
        echo -e "  ${YELLOW}⚠️  Backend running but not responding (may need API key)${NC}"
    else
        echo -e "  ${RED}❌ Backend not accessible${NC}"
    fi
fi

echo ""
echo "Breeze Proxy (8081):"
BREEZE_RESPONSE=$(curl -s --max-time 2 http://localhost:8081/ 2>/dev/null)
if [ ! -z "$BREEZE_RESPONSE" ]; then
    echo -e "  ${GREEN}✅ Breeze Proxy responding${NC}"
    echo "  Response: $BREEZE_RESPONSE"
else
    if netstat -tuln 2>/dev/null | grep -q ':8081' || ss -tuln 2>/dev/null | grep -q ':8081'; then
        echo -e "  ${YELLOW}⚠️  Breeze Proxy running but not responding${NC}"
    else
        echo -e "  ${RED}❌ Breeze Proxy not accessible${NC}"
    fi
fi

echo ""
echo "Frontend ($FRONTEND_PORT):"
if [ ! -z "$FRONTEND_PORT" ]; then
    if curl -s --max-time 2 http://localhost:$FRONTEND_PORT/ | grep -q "<!DOCTYPE html>" 2>/dev/null; then
        echo -e "  ${GREEN}✅ Frontend responding${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Frontend running but response unclear${NC}"
    fi
else
    echo -e "  ${RED}❌ Frontend not running${NC}"
fi

echo ""
echo "================================"
echo "Next Steps"
echo "================================"
echo ""

if [ $RUNNING -lt 3 ]; then
    echo "Start missing services (see commands above), then run this script again."
    echo ""
    echo "Or use the automated startup script:"
    echo "  cd ~/Market-Intelligence-Testing"
    echo "  ./start-all.sh"
else
    echo "All services running! 🎉"
    echo ""
    echo "If you can't access from browser:"
    echo "1. Check GCP firewall rules allow ports 5000, 8081, 8082"
    echo "2. Make sure VITE_API_URL is set correctly in frontend"
    echo "3. Wait 30 seconds for services to fully initialize"
    echo "4. Check browser console (F12) for errors"
fi

echo ""
