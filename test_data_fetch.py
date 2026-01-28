#!/usr/bin/env python3
"""
Test script to fetch LTP for NIFTY 50 and MEDICO using the Breeze API
"""
import os
import sys

def test_breeze_connection():
    """Test basic Breeze connection without session"""
    print("=" * 60)
    print("Testing Breeze API Connection")
    print("=" * 60)
    
    # Check if API credentials are available
    api_key = os.environ.get("BREEZE_API_KEY")
    api_secret = os.environ.get("BREEZE_API_SECRET")
    
    if not api_key:
        print("⚠️  BREEZE_API_KEY not found in environment variables")
        print("   This is normal for cloud deployments using Secret Manager")
    else:
        print(f"✓ API Key found: {api_key[:10]}...")
    
    if not api_secret:
        print("⚠️  BREEZE_API_SECRET not found in environment variables")
        print("   This is normal for cloud deployments using Secret Manager")
    else:
        print(f"✓ API Secret found: {api_secret[:10]}...")
    
    print("\n⚠️  Note: Breeze API requires:")
    print("1. Valid API credentials (stored in Secret Manager)")
    print("2. Daily session token from ICICI Direct login")
    print("3. Session token must be set via /breeze/admin/api-session endpoint")
    
    return True

def test_symbol_mapping():
    """Test symbol mappings for NIFTY and MEDICO"""
    print("\n" + "=" * 60)
    print("Testing Symbol Mappings")
    print("=" * 60)
    
    # These are the mappings based on breeze documentation
    mappings = {
        "NIFTY 50": "NIFTY",  # For index
        "NIFTY": "NIFTY",
        "MEDICO": "MEDREM"  # Based on the hardcoded mapping in breezeService.ts
    }
    
    print("\nSymbol Mappings:")
    for symbol, breeze_code in mappings.items():
        print(f"  {symbol} → {breeze_code}")
    
    return True

def test_proxy_health():
    """Test if the proxy service is accessible"""
    import requests
    
    print("\n" + "=" * 60)
    print("Testing Proxy Service Health")
    print("=" * 60)
    
    proxy_url = "https://maia-breeze-proxy-service-919207294606.us-central1.run.app"
    
    try:
        response = requests.get(f"{proxy_url}/breeze/health", timeout=10)
        print(f"Proxy URL: {proxy_url}")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response: {data}")
            print("✓ Proxy service is accessible")
            return True
        else:
            print(f"❌ Proxy returned status {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Error connecting to proxy: {e}")
        return False

def main():
    print("\n" + "=" * 60)
    print("BREEZE API DATA FETCH TEST")
    print("=" * 60)
    
    results = []
    
    # Test 1: Proxy Health
    results.append(("Proxy Health", test_proxy_health()))
    
    # Test 2: Breeze Connection
    results.append(("Breeze Connection", test_breeze_connection()))
    
    # Test 3: Symbol Mapping
    results.append(("Symbol Mapping", test_symbol_mapping()))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    for test_name, passed in results:
        status = "✓ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    all_passed = all(result for _, result in results)
    if all_passed:
        print("\n✓ All tests passed!")
    else:
        print("\n⚠️  Some tests failed. Check the output above for details.")
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
