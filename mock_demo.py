#!/usr/bin/env python3
"""
Mock test to demonstrate how the Market Intelligence API works
This simulates the data flow without requiring actual ICICI credentials
"""
import json

def mock_breeze_response_nifty():
    """Mock response from Breeze API for NIFTY"""
    return {
        "Success": {
            "last_traded_price": 23750.45,
            "change": 125.30,
            "percent_change": 0.53,
            "high": 23800.00,
            "low": 23650.00,
            "open": 23670.00,
            "volume": 45678900,
            "previous_close": 23625.15,
            "best_bid_price": 23749.50,
            "best_bid_quantity": 150,
            "best_offer_price": 23751.00,
            "best_offer_quantity": 200,
            "stock_code": "NIFTY"
        }
    }

def mock_breeze_response_medico():
    """Mock response from Breeze API for MEDICO (mapped to MEDREM)"""
    return {
        "Success": {
            "last_traded_price": 385.60,
            "change": 12.40,
            "percent_change": 3.32,
            "high": 388.50,
            "low": 373.20,
            "open": 375.00,
            "volume": 234560,
            "previous_close": 373.20,
            "best_bid_price": 385.50,
            "best_bid_quantity": 500,
            "best_offer_price": 385.80,
            "best_offer_quantity": 300,
            "stock_code": "MEDREM"
        }
    }

def demonstrate_api_flow():
    """Demonstrate the complete API flow"""
    print("="*70)
    print(" " * 15 + "MARKET INTELLIGENCE API - MOCK DEMONSTRATION")
    print("="*70)
    
    print("\n" + "="*70)
    print("Step 1: Symbol Mapping")
    print("="*70)
    print("The system maps NSE symbols to Breeze codes:")
    print("  NIFTY → NIFTY (Index)")
    print("  MEDICO → MEDREM (Stock)")
    print("\nThis mapping is stored in Supabase nse_master_list table")
    
    print("\n" + "="*70)
    print("Step 2: Fetch LTP for NIFTY 50")
    print("="*70)
    print("\nRequest to Backend:")
    request = {"symbol": "NIFTY"}
    print(json.dumps(request, indent=2))
    
    print("\nBackend Maps Symbol:")
    print("  Original: NIFTY")
    print("  Breeze Code: NIFTY")
    
    print("\nBackend Forwards to Proxy:")
    proxy_request = {
        "stock_code": "NIFTY",
        "exchange_code": "NSE",
        "product_type": "cash"
    }
    print(json.dumps(proxy_request, indent=2))
    
    print("\nProxy Calls Breeze API:")
    print("  client.get_quotes(stock_code='NIFTY', exchange_code='NSE', product_type='cash')")
    
    print("\nResponse from Breeze API (formatted):")
    nifty_response = mock_breeze_response_nifty()
    print(json.dumps(nifty_response, indent=2))
    
    print("\n✓ NIFTY 50 LTP: ₹{:.2f}".format(nifty_response["Success"]["last_traded_price"]))
    print("  Change: +₹{:.2f} (+{:.2f}%)".format(
        nifty_response["Success"]["change"],
        nifty_response["Success"]["percent_change"]
    ))
    
    print("\n" + "="*70)
    print("Step 3: Fetch LTP for MEDICO")
    print("="*70)
    print("\nRequest to Backend:")
    request = {"symbol": "MEDICO"}
    print(json.dumps(request, indent=2))
    
    print("\nBackend Maps Symbol:")
    print("  Original: MEDICO")
    print("  Breeze Code: MEDREM (from Supabase mapping)")
    
    print("\nBackend Forwards to Proxy:")
    proxy_request = {
        "stock_code": "MEDREM",
        "exchange_code": "NSE",
        "product_type": "cash"
    }
    print(json.dumps(proxy_request, indent=2))
    
    print("\nProxy Calls Breeze API:")
    print("  client.get_quotes(stock_code='MEDREM', exchange_code='NSE', product_type='cash')")
    
    print("\nResponse from Breeze API (formatted):")
    medico_response = mock_breeze_response_medico()
    print(json.dumps(medico_response, indent=2))
    
    print("\n✓ MEDICO (MEDREM) LTP: ₹{:.2f}".format(medico_response["Success"]["last_traded_price"]))
    print("  Change: +₹{:.2f} (+{:.2f}%)".format(
        medico_response["Success"]["change"],
        medico_response["Success"]["percent_change"]
    ))
    
    print("\n" + "="*70)
    print("Summary")
    print("="*70)
    print("\n✓ NIFTY 50: Successfully fetched LTP = ₹{:.2f}".format(
        nifty_response["Success"]["last_traded_price"]
    ))
    print("✓ MEDICO: Successfully fetched LTP = ₹{:.2f}".format(
        medico_response["Success"]["last_traded_price"]
    ))
    print("\nBoth symbols can be fetched successfully once:")
    print("1. Breeze API credentials are configured")
    print("2. Daily session token is set")
    print("3. Services are deployed and running")
    
    print("\n" + "="*70)
    print("Key Points")
    print("="*70)
    print("""
1. Symbol Mapping: Essential for correct data fetching
   - Stored in Supabase nse_master_list table
   - Can be updated without code changes

2. Session Management: Required daily
   - Obtain from ICICI Direct login
   - Set via /api/breeze/admin/api-session
   - Valid until market close

3. Error Handling: Comprehensive
   - Network errors: Timeout, Connection issues
   - API errors: Invalid symbol, Session expired
   - Data errors: Empty response, Invalid format

4. Testing Endpoints:
   - GET /api/test/fetch-symbols - Test both NIFTY & MEDICO
   - POST /api/market/quote - Fetch single symbol
   - GET /api/health - Check service status
    """)
    
    print("="*70)
    print(" " * 20 + "END OF DEMONSTRATION")
    print("="*70)

if __name__ == "__main__":
    demonstrate_api_flow()
