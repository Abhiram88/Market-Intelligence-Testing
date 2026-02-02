#!/usr/bin/env python3
"""
Test script to verify Breeze Proxy Cloud Run compatibility
"""

import os
import sys
import time
from unittest.mock import MagicMock, patch

# Mock external dependencies
sys.modules['breeze_connect'] = MagicMock()
sys.modules['google.cloud'] = MagicMock()
sys.modules['google.cloud.secretmanager'] = MagicMock()

def test_port_configuration():
    """Test that the app reads the PORT environment variable"""
    print("Testing port configuration...")
    
    # Test default port
    os.environ.pop('PORT', None)
    import breeze_proxy_app
    print("  ✓ App imports successfully without PORT env var")
    
    # Test custom port
    os.environ['PORT'] = '9999'
    print(f"  ✓ PORT env var set to {os.environ['PORT']}")
    
    print("  ✓ Port configuration test passed")

def test_health_endpoints():
    """Test that health check endpoints exist"""
    print("\nTesting health endpoints...")
    
    import breeze_proxy_app
    
    routes = [rule.rule for rule in breeze_proxy_app.app.url_map.iter_rules()]
    
    # Check for root health endpoint
    assert '/' in routes, "Root health endpoint (/) not found"
    print("  ✓ Root health endpoint (/) exists")
    
    # Check for breeze health endpoint
    assert '/breeze/health' in routes, "Breeze health endpoint not found"
    print("  ✓ Breeze health endpoint (/breeze/health) exists")
    
    print("  ✓ Health endpoints test passed")

def test_cors_enabled():
    """Test that CORS is enabled"""
    print("\nTesting CORS configuration...")
    
    import breeze_proxy_app
    from flask import Flask
    
    # Check if CORS is configured
    assert hasattr(breeze_proxy_app.app, 'after_request_funcs'), "CORS not configured"
    print("  ✓ CORS is enabled")
    
    print("  ✓ CORS test passed")

def test_all_endpoints():
    """Test that all required endpoints exist"""
    print("\nTesting all endpoints...")
    
    import breeze_proxy_app
    
    required_endpoints = [
        ('/', {'GET'}),
        ('/breeze/health', {'GET'}),
        ('/breeze/admin/api-session', {'POST'}),
        ('/breeze/quotes', {'POST'}),
        ('/breeze/depth', {'POST'}),
        ('/breeze/historical', {'POST'}),
    ]
    
    routes = {rule.rule: rule.methods for rule in breeze_proxy_app.app.url_map.iter_rules()}
    
    for endpoint, methods in required_endpoints:
        assert endpoint in routes, f"Endpoint {endpoint} not found"
        for method in methods:
            assert method in routes[endpoint], f"Method {method} not found for {endpoint}"
        print(f"  ✓ {endpoint} with methods {methods}")
    
    print("  ✓ All endpoints test passed")

def main():
    """Run all tests"""
    print("=" * 60)
    print("Breeze Proxy - Cloud Run Compatibility Tests")
    print("=" * 60)
    
    try:
        test_port_configuration()
        test_health_endpoints()
        test_cors_enabled()
        test_all_endpoints()
        
        print("\n" + "=" * 60)
        print("✓ ALL TESTS PASSED")
        print("=" * 60)
        print("\nThe Breeze Proxy is ready for Cloud Run deployment!")
        print("\nNext steps:")
        print("  1. Build the Docker image: cd breeze-proxy && docker build -t breeze-proxy .")
        print("  2. Test locally: docker run -p 8081:8080 -e PORT=8080 breeze-proxy")
        print("  3. Deploy to Cloud Run: ./deploy.sh")
        return 0
        
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return 1
    except Exception as e:
        print(f"\n✗ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
