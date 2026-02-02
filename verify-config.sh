#!/bin/bash

# Quick verification script for configuration
echo "=========================================="
echo "Configuration Verification"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -d "frontend" ]; then
    echo "❌ Error: Must run from Market-Intelligence-Testing directory"
    echo "Run: cd ~/Market-Intelligence-Testing"
    exit 1
fi

echo "1. Checking Services Status..."
echo "----------------------------"
SERVICES_OK=true

if netstat -tuln 2>/dev/null | grep -q ':5000' || ss -tuln 2>/dev/null | grep -q ':5000'; then
    echo "✅ Backend running on port 5000"
else
    echo "❌ Backend NOT running on port 5000"
    SERVICES_OK=false
fi

if netstat -tuln 2>/dev/null | grep -q ':8081' || ss -tuln 2>/dev/null | grep -q ':8081'; then
    echo "✅ Breeze Proxy running on port 8081"
else
    echo "❌ Breeze Proxy NOT running on port 8081"
    SERVICES_OK=false
fi

if netstat -tuln 2>/dev/null | grep -q ':8082' || ss -tuln 2>/dev/null | grep -q ':8082'; then
    echo "✅ Frontend running on port 8082"
elif netstat -tuln 2>/dev/null | grep -q ':8080' || ss -tuln 2>/dev/null | grep -q ':8080'; then
    echo "✅ Frontend running on port 8080"
else
    echo "❌ Frontend NOT running"
    SERVICES_OK=false
fi

echo ""
echo "2. Checking VITE_API_URL Configuration..."
echo "----------------------------"
cd frontend

# Check .env.local
if [ -f .env.local ]; then
    echo "✅ Found .env.local file:"
    cat .env.local
    if grep -q "VITE_API_URL=http://34.72.13.202:5000" .env.local; then
        echo "✅ VITE_API_URL correctly set in .env.local"
    else
        echo "⚠️  VITE_API_URL in .env.local may not be correct"
    fi
else
    echo "⚠️  No .env.local file found"
    echo "   Creating it now..."
    cat > .env.local << 'EOF'
VITE_API_URL=http://34.72.13.202:5000
EOF
    echo "✅ Created .env.local with VITE_API_URL=http://34.72.13.202:5000"
fi

# Check environment variable
if [ ! -z "$VITE_API_URL" ]; then
    echo "✅ VITE_API_URL environment variable: $VITE_API_URL"
else
    echo "⚠️  VITE_API_URL environment variable not set"
    echo "   (It's OK if it's in .env.local)"
fi

cd ..

echo ""
echo "3. Testing Connectivity..."
echo "----------------------------"

# Get external IP
EXTERNAL_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "34.72.13.202")

# Test backend
echo -n "Backend (port 5000): "
if curl -s --max-time 3 http://localhost:5000/api/market/nifty-realtime >/dev/null 2>&1; then
    echo "✅ Responding"
elif curl -s --max-time 3 -I http://localhost:5000/ | grep -q "200\|404\|500" 2>/dev/null; then
    echo "✅ Responding (may need API key)"
else
    echo "❌ Not responding"
fi

# Test frontend
echo -n "Frontend (port 8082): "
if curl -s --max-time 3 http://localhost:8082/ | grep -q "<!DOCTYPE" 2>/dev/null; then
    echo "✅ Responding"
elif curl -s --max-time 3 http://localhost:8080/ | grep -q "<!DOCTYPE" 2>/dev/null; then
    echo "✅ Responding (on port 8080)"
else
    echo "❌ Not responding"
fi

echo ""
echo "4. Firewall Check..."
echo "----------------------------"
echo "Testing external access (this may take a moment)..."

# Test from external
echo -n "External frontend access: "
if curl -s --max-time 5 http://$EXTERNAL_IP:8082/ | grep -q "<!DOCTYPE" 2>/dev/null; then
    echo "✅ Accessible"
else
    echo "⚠️  Cannot verify (may need to test from browser)"
fi

echo -n "External backend access: "
if curl -s --max-time 5 http://$EXTERNAL_IP:5000/api/market/nifty-realtime >/dev/null 2>&1; then
    echo "✅ Accessible"
elif curl -s --max-time 5 -I http://$EXTERNAL_IP:5000/ | grep -q "200\|404\|500" 2>/dev/null; then
    echo "✅ Accessible (may need API key)"
else
    echo "⚠️  Cannot verify (may need to test from browser)"
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""

if [ "$SERVICES_OK" = true ]; then
    echo "✅ All services are running"
    echo ""
    echo "Access your application at:"
    echo "   🌐 http://$EXTERNAL_IP:8082/"
    echo ""
    echo "If it doesn't work:"
    echo "1. Stop the frontend (Ctrl+C)"
    echo "2. Run: export VITE_API_URL=http://$EXTERNAL_IP:5000"
    echo "3. Run: cd frontend && npm start"
    echo "4. Wait 30 seconds and try again"
    echo ""
    echo "Or restart everything:"
    echo "   cd ~/Market-Intelligence-Testing"
    echo "   ./start-all.sh"
else
    echo "❌ Some services are not running"
    echo ""
    echo "Start missing services:"
    echo "   Terminal 1: python app.py"
    echo "   Terminal 2: cd breeze-proxy && python breeze_proxy_app.py"
    echo "   Terminal 3: cd frontend && npm start"
fi

echo ""
echo "For detailed troubleshooting, see:"
echo "   URGENT_FIX_SERVICES_RUNNING.md"
echo "   LOGGING_AND_DEBUGGING_GUIDE.md"
