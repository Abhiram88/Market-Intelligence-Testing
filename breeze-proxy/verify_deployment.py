#!/usr/bin/env python3
"""
Breeze Proxy Service Verification Script
Tests the deployed Cloud Run service to verify it's operational
"""

import requests
import json
import sys
from datetime import datetime

# Service URL
SERVICE_URL = "https://maia-breeze-proxy-service-919207294606.us-central1.run.app"

def print_header(text):
    """Print a formatted header"""
    print("\n" + "=" * 80)
    print(f"  {text}")
    print("=" * 80)

def test_root_health_endpoint():
    """Test the root health endpoint (/)"""
    print_header("Test 1: Root Health Endpoint")
    
    url = f"{SERVICE_URL}/"
    print(f"URL: {url}")
    
    try:
        response = requests.get(url, timeout=10)
        
        print(f"✓ Status Code: {response.status_code}")
        print(f"✓ Response Time: {response.elapsed.total_seconds():.3f}s")
        print(f"✓ Content-Type: {response.headers.get('Content-Type')}")
        
        # Check for CORS headers
        if 'Access-Control-Allow-Origin' in response.headers:
            print(f"✓ CORS Enabled: {response.headers.get('Access-Control-Allow-Origin')}")
        
        # Parse JSON response
        data = response.json()
        print(f"✓ Response Body: {json.dumps(data, indent=2)}")
        
        # Verify expected fields
        assert data.get('status') == 'ok', "Status should be 'ok'"
        assert data.get('service') == 'breeze-proxy', "Service name should be 'breeze-proxy'"
        assert 'version' in data, "Version should be present"
        
        print("\n✅ Root Health Endpoint: PASS")
        return True
        
    except Exception as e:
        print(f"\n❌ Root Health Endpoint: FAIL")
        print(f"   Error: {type(e).__name__}: {e}")
        return False

def test_breeze_health_endpoint():
    """Test the breeze health endpoint (/breeze/health)"""
    print_header("Test 2: Breeze Health Endpoint")
    
    url = f"{SERVICE_URL}/breeze/health"
    print(f"URL: {url}")
    
    try:
        response = requests.get(url, timeout=10)
        
        print(f"✓ Status Code: {response.status_code}")
        print(f"✓ Response Time: {response.elapsed.total_seconds():.3f}s")
        
        # Parse JSON response
        data = response.json()
        print(f"✓ Response Body: {json.dumps(data, indent=2)}")
        
        # Verify expected fields
        assert 'status' in data, "Status should be present"
        assert 'session_active' in data, "session_active should be present"
        
        print("\n✅ Breeze Health Endpoint: PASS")
        return True
        
    except Exception as e:
        print(f"\n❌ Breeze Health Endpoint: FAIL")
        print(f"   Error: {type(e).__name__}: {e}")
        return False

def test_cors_preflight():
    """Test CORS preflight OPTIONS request"""
    print_header("Test 3: CORS Preflight (OPTIONS)")
    
    url = f"{SERVICE_URL}/breeze/quotes"
    print(f"URL: {url}")
    
    headers = {
        'Origin': 'http://localhost:8080',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
    }
    
    try:
        response = requests.options(url, headers=headers, timeout=10)
        
        print(f"✓ Status Code: {response.status_code}")
        
        # Check CORS headers
        cors_headers = {
            'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
            'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
            'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
        }
        
        print("✓ CORS Headers:")
        for key, value in cors_headers.items():
            print(f"  - {key}: {value}")
        
        # Verify CORS is enabled
        assert cors_headers['Access-Control-Allow-Origin'] is not None, "CORS should be enabled"
        
        print("\n✅ CORS Preflight: PASS")
        return True
        
    except Exception as e:
        print(f"\n❌ CORS Preflight: FAIL")
        print(f"   Error: {type(e).__name__}: {e}")
        return False

def test_quotes_endpoint_without_session():
    """Test quotes endpoint without session (should fail gracefully)"""
    print_header("Test 4: Quotes Endpoint (No Session)")
    
    url = f"{SERVICE_URL}/breeze/quotes"
    print(f"URL: {url}")
    
    payload = {"stock_code": "NIFTY"}
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        
        print(f"✓ Status Code: {response.status_code}")
        print(f"✓ Response Time: {response.elapsed.total_seconds():.3f}s")
        
        # Should return 401 or error about session
        data = response.json()
        print(f"✓ Response Body: {json.dumps(data, indent=2)}")
        
        # Verify it returns an error about session
        assert 'error' in data, "Should return error about missing session"
        
        print("\n✅ Quotes Endpoint (No Session): PASS (correctly returns error)")
        return True
        
    except Exception as e:
        print(f"\n❌ Quotes Endpoint (No Session): FAIL")
        print(f"   Error: {type(e).__name__}: {e}")
        return False

def test_service_metadata():
    """Get service metadata and deployment info"""
    print_header("Test 5: Service Metadata")
    
    url = f"{SERVICE_URL}/"
    
    try:
        response = requests.get(url, timeout=10)
        
        print("✓ Service Information:")
        print(f"  - URL: {SERVICE_URL}")
        print(f"  - Status: {response.status_code}")
        print(f"  - Response Time: {response.elapsed.total_seconds():.3f}s")
        
        # Check all response headers
        print("\n✓ Response Headers:")
        for key, value in response.headers.items():
            print(f"  - {key}: {value}")
        
        print("\n✅ Service Metadata: PASS")
        return True
        
    except Exception as e:
        print(f"\n❌ Service Metadata: FAIL")
        print(f"   Error: {type(e).__name__}: {e}")
        return False

def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("  BREEZE PROXY SERVICE VERIFICATION")
    print(f"  Service: {SERVICE_URL}")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    
    tests = [
        ("Root Health Endpoint", test_root_health_endpoint),
        ("Breeze Health Endpoint", test_breeze_health_endpoint),
        ("CORS Preflight", test_cors_preflight),
        ("Quotes Endpoint (No Session)", test_quotes_endpoint_without_session),
        ("Service Metadata", test_service_metadata),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ {test_name}: EXCEPTION")
            print(f"   Error: {type(e).__name__}: {e}")
            results.append((test_name, False))
    
    # Summary
    print_header("VERIFICATION SUMMARY")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}  {test_name}")
    
    print("\n" + "=" * 80)
    print(f"Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - Service is operational!")
        print("\n🎉 The Breeze Proxy is deployed and accessible!")
        print("   - Health checks: Working")
        print("   - CORS: Enabled")
        print("   - API endpoints: Responding")
        print("   - Ready to route traffic from frontend")
        return 0
    else:
        print("\n❌ SOME TESTS FAILED - Service may have issues")
        return 1

if __name__ == "__main__":
    sys.exit(main())
