#!/usr/bin/env python3
"""
Simple test client to validate Market Intelligence Testing API endpoints
Can be run locally or against deployed services
"""
import requests
import json
import sys
from typing import Optional

class MarketTestClient:
    def __init__(self, backend_url: str, proxy_url: str, admin_key: Optional[str] = None):
        self.backend_url = backend_url.rstrip('/')
        self.proxy_url = proxy_url.rstrip('/')
        self.admin_key = admin_key or ""
    
    def test_backend_health(self):
        """Test backend health endpoint"""
        print("\n" + "="*60)
        print("Testing Backend Health")
        print("="*60)
        
        try:
            url = f"{self.backend_url}/api/health"
            print(f"GET {url}")
            response = requests.get(url, timeout=10)
            print(f"Status: {response.status_code}")
            print(f"Response: {json.dumps(response.json(), indent=2)}")
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_proxy_health(self):
        """Test proxy health endpoint"""
        print("\n" + "="*60)
        print("Testing Proxy Health")
        print("="*60)
        
        try:
            url = f"{self.proxy_url}/breeze/health"
            print(f"GET {url}")
            response = requests.get(url, timeout=10)
            print(f"Status: {response.status_code}")
            print(f"Response: {json.dumps(response.json(), indent=2)}")
            return response.status_code == 200
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_fetch_symbols(self):
        """Test the test endpoint for NIFTY and MEDICO"""
        print("\n" + "="*60)
        print("Testing NIFTY and MEDICO Fetch")
        print("="*60)
        
        try:
            url = f"{self.backend_url}/api/test/fetch-symbols"
            print(f"GET {url}")
            response = requests.get(url, timeout=30)
            print(f"Status: {response.status_code}")
            
            data = response.json()
            print(f"Response:")
            print(json.dumps(data, indent=2))
            
            # Check results
            if data.get("success"):
                print("\n✓ Test passed! Data fetched successfully")
                return True
            else:
                print("\n⚠️  Test returned errors")
                if data.get("errors"):
                    for error in data["errors"]:
                        print(f"  - {error}")
                return False
                
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def test_quote_endpoint(self, symbol: str):
        """Test quote endpoint for a specific symbol"""
        print("\n" + "="*60)
        print(f"Testing Quote Endpoint for {symbol}")
        print("="*60)
        
        try:
            url = f"{self.backend_url}/api/market/quote"
            payload = {"symbol": symbol}
            print(f"POST {url}")
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            response = requests.post(url, json=payload, timeout=30)
            print(f"Status: {response.status_code}")
            
            data = response.json()
            print(f"Response:")
            print(json.dumps(data, indent=2))
            
            return response.status_code == 200 and data.get("Success") is not None
            
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def set_session_token(self, session_token: str):
        """Set Breeze session token"""
        print("\n" + "="*60)
        print("Setting Breeze Session Token")
        print("="*60)
        
        if not self.admin_key:
            print("⚠️  Admin key not provided. Skipping session setup.")
            return False
        
        try:
            url = f"{self.backend_url}/api/breeze/admin/api-session"
            headers = {
                "Content-Type": "application/json",
                "X-Proxy-Admin-Key": self.admin_key
            }
            payload = {"api_session": session_token}
            
            print(f"POST {url}")
            print(f"Payload: {json.dumps(payload, indent=2)}")
            
            response = requests.post(url, json=payload, headers=headers, timeout=30)
            print(f"Status: {response.status_code}")
            print(f"Response: {json.dumps(response.json(), indent=2)}")
            
            return response.status_code == 200
            
        except Exception as e:
            print(f"❌ Error: {e}")
            return False
    
    def run_all_tests(self):
        """Run all available tests"""
        print("\n" + "="*70)
        print(" " * 15 + "MARKET INTELLIGENCE API TEST SUITE")
        print("="*70)
        
        results = []
        
        # Test 1: Backend Health
        results.append(("Backend Health", self.test_backend_health()))
        
        # Test 2: Proxy Health
        results.append(("Proxy Health", self.test_proxy_health()))
        
        # Test 3: Fetch Symbols Test
        results.append(("Fetch Symbols (NIFTY & MEDICO)", self.test_fetch_symbols()))
        
        # Test 4: Quote Endpoint - NIFTY
        results.append(("Quote Endpoint - NIFTY", self.test_quote_endpoint("NIFTY")))
        
        # Test 5: Quote Endpoint - MEDICO
        results.append(("Quote Endpoint - MEDICO", self.test_quote_endpoint("MEDICO")))
        
        # Summary
        print("\n" + "="*70)
        print(" " * 25 + "TEST SUMMARY")
        print("="*70)
        
        passed = 0
        failed = 0
        
        for test_name, result in results:
            status = "✓ PASS" if result else "❌ FAIL"
            print(f"{status:10} | {test_name}")
            if result:
                passed += 1
            else:
                failed += 1
        
        print("="*70)
        print(f"Total: {len(results)} | Passed: {passed} | Failed: {failed}")
        
        if failed == 0:
            print("✓ All tests passed!")
            return 0
        else:
            print(f"⚠️  {failed} test(s) failed")
            return 1

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Market Intelligence API Test Client')
    parser.add_argument('--backend', 
                       default='http://localhost:5000',
                       help='Backend URL (default: http://localhost:5000)')
    parser.add_argument('--proxy',
                       default='http://localhost:8081',
                       help='Proxy URL (default: http://localhost:8081)')
    parser.add_argument('--admin-key',
                       help='Admin key for session setup')
    parser.add_argument('--session-token',
                       help='Breeze session token to set')
    parser.add_argument('--test',
                       choices=['health', 'proxy', 'fetch', 'quote-nifty', 'quote-medico', 'all'],
                       default='all',
                       help='Which test to run (default: all)')
    parser.add_argument('--symbol',
                       help='Symbol to test with quote endpoint')
    
    args = parser.parse_args()
    
    client = MarketTestClient(args.backend, args.proxy, args.admin_key)
    
    # Set session token if provided
    if args.session_token:
        if not client.set_session_token(args.session_token):
            print("\n⚠️  Failed to set session token. Tests may fail.")
    
    # Run requested tests
    if args.test == 'all':
        return client.run_all_tests()
    elif args.test == 'health':
        return 0 if client.test_backend_health() else 1
    elif args.test == 'proxy':
        return 0 if client.test_proxy_health() else 1
    elif args.test == 'fetch':
        return 0 if client.test_fetch_symbols() else 1
    elif args.test == 'quote-nifty':
        return 0 if client.test_quote_endpoint('NIFTY') else 1
    elif args.test == 'quote-medico':
        return 0 if client.test_quote_endpoint('MEDICO') else 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
