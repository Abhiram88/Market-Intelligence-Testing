#!/usr/bin/env python3
"""
Session Token Helper
Helps users set the daily Breeze session token
"""
import requests
import sys
import json

def set_session_token(backend_url: str, admin_key: str, session_token: str):
    """Set the Breeze session token"""
    
    print("="*60)
    print("Setting Breeze Session Token")
    print("="*60)
    
    url = f"{backend_url.rstrip('/')}/api/breeze/admin/api-session"
    headers = {
        "Content-Type": "application/json",
        "X-Proxy-Admin-Key": admin_key
    }
    payload = {"api_session": session_token}
    
    print(f"\nEndpoint: {url}")
    print(f"Admin Key: ***{admin_key[-4:]}" if len(admin_key) > 4 else "Admin Key: ****")
    print(f"Session Token: ***{session_token[-8:]}" if len(session_token) > 8 else "Session Token: ****")
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"Response: {json.dumps(result, indent=2)}")
            print("\n✓ Session token set successfully!")
            print("\nYou can now fetch market data for today's trading session.")
            return True
        else:
            try:
                error_data = response.json()
                print(f"Error: {json.dumps(error_data, indent=2)}")
            except (json.JSONDecodeError, ValueError):
                print(f"Error: {response.text}")
            print("\n❌ Failed to set session token")
            return False
            
    except requests.exceptions.Timeout:
        print("\n❌ Request timed out. Check if the backend service is running.")
        return False
    except requests.exceptions.ConnectionError:
        print("\n❌ Cannot connect to backend. Check the URL and network connection.")
        return False
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False

def get_session_instructions():
    """Print instructions for obtaining session token"""
    print("""
{"="*60}
How to Obtain ICICI Direct Session Token
{"="*60}

1. Login to ICICI Direct Website:
   URL: https://secure.icicidirect.com/

2. After successful login, look at the browser's address bar
   You'll see a URL like:
   https://secure.icicidirect.com/...?sessionToken=ABC123XYZ...

3. Copy the value after "sessionToken=" parameter
   Example: If URL shows "?sessionToken=ABC123XYZ456DEF"
   Copy: ABC123XYZ456DEF

4. Use this token with this script

IMPORTANT NOTES:
- Session token expires at market close (3:30 PM IST)
- You need to get a new token every trading day
- Keep the token secure - don't share it publicly
- Token is tied to your ICICI Direct account

{"="*60}
""")

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Set daily Breeze session token',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Set session token for production
  python set_session.py \\
    --backend https://market-backend.run.app \\
    --admin-key YOUR_ADMIN_KEY \\
    --token YOUR_SESSION_TOKEN

  # Show instructions for getting token
  python set_session.py --help-token

  # Interactive mode
  python set_session.py --interactive
        """
    )
    
    parser.add_argument('--backend',
                       help='Backend URL (e.g., https://market-backend.run.app)')
    parser.add_argument('--admin-key',
                       help='Admin key for authentication')
    parser.add_argument('--token',
                       help='Breeze session token from ICICI Direct')
    parser.add_argument('--help-token',
                       action='store_true',
                       help='Show instructions for obtaining session token')
    parser.add_argument('--interactive',
                       action='store_true',
                       help='Interactive mode - prompts for all inputs')
    
    args = parser.parse_args()
    
    # Show token instructions if requested
    if args.help_token:
        get_session_instructions()
        return 0
    
    # Interactive mode
    if args.interactive or not (args.backend and args.admin_key and args.token):
        print("\n" + "="*60)
        print("Interactive Session Token Setup")
        print("="*60)
        
        if not args.backend:
            print("\nEnter backend URL:")
            print("Examples:")
            print("  - Production: https://market-attribution-backend-919207294606.us-west1.run.app")
            print("  - Local: http://localhost:5000")
            backend = input("Backend URL: ").strip()
        else:
            backend = args.backend
        
        if not args.admin_key:
            admin_key = input("\nAdmin Key: ").strip()
        else:
            admin_key = args.admin_key
        
        if not args.token:
            print("\nNeed help getting the session token? Run:")
            print("  python set_session.py --help-token")
            token = input("\nSession Token: ").strip()
        else:
            token = args.token
    else:
        backend = args.backend
        admin_key = args.admin_key
        token = args.token
    
    # Validate inputs
    if not backend or not admin_key or not token:
        print("\n❌ Error: Missing required parameters")
        print("Use --help for usage information")
        return 1
    
    # Set session token
    success = set_session_token(backend, admin_key, token)
    
    if success:
        print("\n" + "="*60)
        print("Next Steps")
        print("="*60)
        print("\n1. Test data fetching:")
        print(f"   curl {backend}/api/test/fetch-symbols")
        print("\n2. Fetch specific symbol:")
        print(f"   curl -X POST {backend}/api/market/quote \\")
        print('     -H "Content-Type: application/json" \\')
        print('     -d \'{"symbol": "NIFTY"}\'')
        print("\n3. Check health:")
        print(f"   curl {backend}/api/health")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
