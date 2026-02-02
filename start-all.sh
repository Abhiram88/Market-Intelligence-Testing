#!/bin/bash

# Market Intelligence Application Startup Script
# Starts all three services: Backend, Breeze Proxy, and Frontend

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                              ║"
echo "║              Market Intelligence Application - Startup Script               ║"
echo "║                                                                              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a port is in use
check_port() {
    lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
}

# Check prerequisites
echo "🔍 Checking prerequisites..."
echo ""

MISSING_DEPS=0

if ! command_exists python3; then
    echo -e "${RED}❌ Python 3 not found${NC}"
    MISSING_DEPS=1
else
    echo -e "${GREEN}✅ Python 3 found${NC}"
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm not found${NC}"
    MISSING_DEPS=1
else
    echo -e "${GREEN}✅ npm found${NC}"
fi

if [ $MISSING_DEPS -eq 1 ]; then
    echo ""
    echo -e "${RED}Missing prerequisites. Please install them first.${NC}"
    exit 1
fi

echo ""

# Check if ports are available
echo "🔍 Checking port availability..."
echo ""

PORTS_BUSY=0

if check_port 5000; then
    echo -e "${YELLOW}⚠️  Port 5000 (Backend) is already in use${NC}"
    PORTS_BUSY=1
else
    echo -e "${GREEN}✅ Port 5000 (Backend) is available${NC}"
fi

if check_port 8080; then
    echo -e "${YELLOW}⚠️  Port 8080 (Frontend) is already in use${NC}"
    PORTS_BUSY=1
else
    echo -e "${GREEN}✅ Port 8080 (Frontend) is available${NC}"
fi

if check_port 8081; then
    echo -e "${YELLOW}⚠️  Port 8081 (Breeze Proxy) is already in use${NC}"
    echo -e "${YELLOW}   (Will try alternative ports)${NC}"
else
    echo -e "${GREEN}✅ Port 8081 (Breeze Proxy) is available${NC}"
fi

if [ $PORTS_BUSY -eq 1 ]; then
    echo ""
    echo -e "${YELLOW}Some ports are in use. Do you want to continue? (y/n)${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Startup cancelled."
        exit 1
    fi
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════════"
echo ""

# Check if we're in the right directory
if [ ! -f "app.py" ]; then
    echo -e "${RED}❌ Error: app.py not found. Please run this script from the repository root.${NC}"
    exit 1
fi

# Function to start services based on OS
if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # macOS or Linux
    echo "🚀 Starting services in separate terminal windows..."
    echo ""
    
    # Start Backend
    echo -e "${GREEN}Starting Backend (Port 5000)...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        osascript -e 'tell app "Terminal" to do script "cd '"$(pwd)"' && echo \"=== BACKEND (app.py) - Port 5000 ===\" && python app.py"'
    else
        # Linux - try different terminal emulators
        if command_exists gnome-terminal; then
            gnome-terminal --title="Backend - Port 5000" -- bash -c "cd '$(pwd)' && echo '=== BACKEND (app.py) - Port 5000 ===' && python3 app.py; exec bash"
        elif command_exists xterm; then
            xterm -title "Backend - Port 5000" -e "cd '$(pwd)' && echo '=== BACKEND (app.py) - Port 5000 ===' && python3 app.py; bash" &
        else
            echo -e "${YELLOW}⚠️  No terminal emulator found. Please start manually: python app.py${NC}"
        fi
    fi
    sleep 2
    
    # Start Breeze Proxy
    echo -e "${GREEN}Starting Breeze Proxy (Port 8081)...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        osascript -e 'tell app "Terminal" to do script "cd '"$(pwd)/breeze-proxy"' && echo \"=== BREEZE PROXY - Port 8081 ===\" && ./start.sh"'
    else
        # Linux
        if command_exists gnome-terminal; then
            gnome-terminal --title="Breeze Proxy - Port 8081" -- bash -c "cd '$(pwd)/breeze-proxy' && echo '=== BREEZE PROXY - Port 8081 ===' && ./start.sh; exec bash"
        elif command_exists xterm; then
            xterm -title "Breeze Proxy - Port 8081" -e "cd '$(pwd)/breeze-proxy' && echo '=== BREEZE PROXY - Port 8081 ===' && ./start.sh; bash" &
        else
            echo -e "${YELLOW}⚠️  No terminal emulator found. Please start manually: cd breeze-proxy && ./start.sh${NC}"
        fi
    fi
    sleep 2
    
    # Start Frontend
    echo -e "${GREEN}Starting Frontend (Port 8080)...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        osascript -e 'tell app "Terminal" to do script "cd '"$(pwd)/frontend"' && echo \"=== FRONTEND - Port 8080 ===\" && npm start"'
    else
        # Linux
        if command_exists gnome-terminal; then
            gnome-terminal --title="Frontend - Port 8080" -- bash -c "cd '$(pwd)/frontend' && echo '=== FRONTEND - Port 8080 ===' && npm start; exec bash"
        elif command_exists xterm; then
            xterm -title "Frontend - Port 8080" -e "cd '$(pwd)/frontend' && echo '=== FRONTEND - Port 8080 ===' && npm start; bash" &
        else
            echo -e "${YELLOW}⚠️  No terminal emulator found. Please start manually: cd frontend && npm start${NC}"
        fi
    fi
    
    echo ""
    echo "══════════════════════════════════════════════════════════════════════════════"
    echo ""
    echo -e "${GREEN}✅ All services are starting in separate terminal windows!${NC}"
    echo ""
    echo "Services:"
    echo "  • Backend:      http://localhost:5000"
    echo "  • Breeze Proxy: http://localhost:8081"
    echo "  • Frontend:     http://localhost:8080"
    echo ""
    echo "Wait a few seconds for all services to start, then open:"
    echo -e "${GREEN}  👉 http://localhost:8080${NC}"
    echo ""
    
else
    # Windows or unsupported OS
    echo -e "${YELLOW}⚠️  Automatic terminal launching not supported on this OS.${NC}"
    echo ""
    echo "Please start services manually in three separate terminals:"
    echo ""
    echo "Terminal 1 (Backend):"
    echo "  python app.py"
    echo ""
    echo "Terminal 2 (Breeze Proxy):"
    echo "  cd breeze-proxy"
    echo "  ./start.sh"
    echo ""
    echo "Terminal 3 (Frontend):"
    echo "  cd frontend"
    echo "  npm start"
    echo ""
fi

echo "══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "To stop all services, press Ctrl+C in each terminal window."
echo ""
echo "For more information, see: HOW_TO_RUN.md"
echo ""
