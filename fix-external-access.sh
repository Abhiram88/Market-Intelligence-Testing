#!/bin/bash

# Quick Fix for External IP Access
# Run this on your GCP VM to enable external access

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                              ║"
echo "║              External IP Access - Quick Fix Script                           ║"
echo "║                                                                              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Get external IP
EXTERNAL_IP=$(curl -s ifconfig.me)
if [ -z "$EXTERNAL_IP" ]; then
    EXTERNAL_IP="34.72.13.202"  # Fallback to your IP
fi

echo "🔍 Detected External IP: $EXTERNAL_IP"
echo ""

# Check if we're on GCP
if command -v gcloud &> /dev/null; then
    echo "✅ GCloud CLI detected"
    echo ""
    
    # Check if firewall rules exist
    echo "📋 Checking existing firewall rules..."
    gcloud compute firewall-rules list --filter="name:allow-market" --format="table(name,allowed)"
    echo ""
    
    echo "🔧 Creating/Updating firewall rules..."
    echo ""
    
    # Create firewall rule for all three ports
    gcloud compute firewall-rules create allow-market-intelligence-external \
      --allow tcp:5000,tcp:8081,tcp:8082,tcp:8080 \
      --source-ranges 0.0.0.0/0 \
      --description "Market Intelligence Application - All Ports" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Firewall rules created successfully"
    else
        echo "⚠️  Firewall rules may already exist (this is OK)"
        echo "   Updating existing rule..."
        gcloud compute firewall-rules update allow-market-intelligence-external \
          --allow tcp:5000,tcp:8081,tcp:8082,tcp:8080 2>/dev/null
    fi
    echo ""
else
    echo "⚠️  GCloud CLI not detected. Please install or run firewall commands manually."
    echo ""
    echo "Run these commands:"
    echo "  gcloud compute firewall-rules create allow-market-intelligence-external \\"
    echo "    --allow tcp:5000,tcp:8081,tcp:8082,tcp:8080 \\"
    echo "    --source-ranges 0.0.0.0/0"
    echo ""
fi

# Check what's running on ports
echo "🔍 Checking running services..."
echo ""

PORT_5000=$(lsof -ti:5000 2>/dev/null)
PORT_8081=$(lsof -ti:8081 2>/dev/null)
PORT_8082=$(lsof -ti:8082 2>/dev/null)

if [ -n "$PORT_5000" ]; then
    echo "✅ Backend running on port 5000 (PID: $PORT_5000)"
else
    echo "❌ Backend NOT running on port 5000"
fi

if [ -n "$PORT_8081" ]; then
    echo "✅ Breeze Proxy running on port 8081 (PID: $PORT_8081)"
else
    echo "❌ Breeze Proxy NOT running on port 8081"
fi

if [ -n "$PORT_8082" ]; then
    echo "✅ Frontend running on port 8082 (PID: $PORT_8082)"
else
    echo "❌ Frontend NOT running on port 8082"
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo ""

# Test connectivity
echo "🧪 Testing connectivity..."
echo ""

echo "Testing Backend (5000)..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/market/nifty-realtime | grep -q "200\|500\|404"; then
    echo "  ✅ Backend responding locally"
else
    echo "  ❌ Backend not responding"
fi

echo "Testing Breeze Proxy (8081)..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/health | grep -q "200"; then
    echo "  ✅ Breeze Proxy responding locally"
else
    echo "  ❌ Breeze Proxy not responding"
fi

echo "Testing Frontend (8082)..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8082/ | grep -q "200"; then
    echo "  ✅ Frontend responding locally"
else
    echo "  ❌ Frontend not responding"
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo ""

# Provide instructions
echo "📝 Next Steps:"
echo ""
echo "1. Configure Frontend to use external IP:"
echo "   export VITE_API_URL=http://$EXTERNAL_IP:5000"
echo "   cd frontend && npm start"
echo ""
echo "2. Wait 1-2 minutes for firewall rules to propagate"
echo ""
echo "3. Access your application:"
echo "   👉 http://$EXTERNAL_IP:8082/"
echo ""
echo "4. Test individual services:"
echo "   Backend:      http://$EXTERNAL_IP:5000/api/market/nifty-realtime"
echo "   Breeze Proxy: http://$EXTERNAL_IP:8081/health"
echo "   Frontend:     http://$EXTERNAL_IP:8082/"
echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "⚠️  Security Warning:"
echo "   These rules allow access from ANY IP (0.0.0.0/0)"
echo "   For production, restrict to specific IPs:"
echo "   gcloud compute firewall-rules update allow-market-intelligence-external \\"
echo "     --source-ranges YOUR_IP/32"
echo ""
echo "📖 For more details, see: EXTERNAL_ACCESS_GUIDE.md"
echo ""
