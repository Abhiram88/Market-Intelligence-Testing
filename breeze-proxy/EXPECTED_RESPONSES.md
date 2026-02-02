# Expected API Responses - Breeze Proxy

This document shows the expected responses from the deployed Breeze Proxy service.

## Service URL
```
https://maia-breeze-proxy-service-919207294606.us-central1.run.app
```

---

## 1. Root Health Check

### Request
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/
```

### Expected Response
**Status**: `200 OK`

**Headers**:
```
Content-Type: application/json
Access-Control-Allow-Origin: *
```

**Body**:
```json
{
  "status": "ok",
  "service": "breeze-proxy",
  "version": "1.0.0"
}
```

---

## 2. Breeze Health Check

### Request
```bash
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/health
```

### Expected Response
**Status**: `200 OK`

**Body** (when no session is set):
```json
{
  "status": "ok",
  "session_active": false
}
```

**Body** (when session is active):
```json
{
  "status": "ok",
  "session_active": true
}
```

---

## 3. CORS Preflight (OPTIONS)

### Request
```bash
curl -X OPTIONS https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/quotes \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
```

### Expected Response
**Status**: `200 OK` or `204 No Content`

**Headers** (must include):
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## 4. Quotes Endpoint (Without Session)

### Request
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/quotes \
  -H "Content-Type: application/json" \
  -d '{"stock_code": "NIFTY", "exchange_code": "NSE"}'
```

### Expected Response
**Status**: `401 Unauthorized`

**Body**:
```json
{
  "error": "Breeze session token not set. Use /admin/api-session"
}
```

---

## 5. Set Session (Admin Endpoint)

### Request
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/admin/api-session \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{"api_session": "YOUR_SESSION_TOKEN"}'
```

### Expected Response (Success)
**Status**: `200 OK`

**Body**:
```json
{
  "status": "success",
  "message": "Daily session activated"
}
```

### Expected Response (Unauthorized)
**Status**: `401 Unauthorized`

**Body**:
```json
{
  "error": "Unauthorized"
}
```

---

## 6. Quotes Endpoint (With Valid Session)

### Request
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/quotes \
  -H "Content-Type: application/json" \
  -d '{"stock_code": "RELIANCE", "exchange_code": "NSE"}'
```

### Expected Response
**Status**: `200 OK`

**Body**:
```json
{
  "Success": {
    "last_traded_price": 2450.50,
    "change": 15.30,
    "percent_change": 0.63,
    "high": 2465.00,
    "low": 2430.20,
    "open": 2440.00,
    "volume": 1234567,
    "previous_close": 2435.20,
    "best_bid_price": 2450.00,
    "best_bid_quantity": 100,
    "best_offer_price": 2451.00,
    "best_offer_quantity": 50
  }
}
```

---

## 7. Market Depth Endpoint

### Request
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/depth \
  -H "Content-Type: application/json" \
  -d '{"stock_code": "RELIANCE", "exchange_code": "NSE"}'
```

### Expected Response (With Valid Session)
**Status**: `200 OK`

**Body**:
```json
{
  "Success": [
    {
      "best_bid_price": 2450.00,
      "best_bid_quantity": 100,
      "best_offer_price": 2451.00,
      "best_offer_quantity": 50,
      "total_buy_quantity": 5000,
      "total_sell_quantity": 4500
    }
  ]
}
```

---

## 8. Historical Data Endpoint

### Request
```bash
curl -X POST https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/historical \
  -H "Content-Type: application/json" \
  -d '{
    "stock_code": "RELIANCE",
    "exchange_code": "NSE",
    "from_date": "2024-01-01",
    "to_date": "2024-01-31",
    "interval": "1day"
  }'
```

### Expected Response (With Valid Session)
**Status**: `200 OK`

**Body**:
```json
{
  "Success": [
    {
      "datetime": "2024-01-01 00:00:00",
      "open": 2400.00,
      "high": 2450.00,
      "low": 2390.00,
      "close": 2435.20,
      "volume": 5000000
    },
    {
      "datetime": "2024-01-02 00:00:00",
      "open": 2435.20,
      "high": 2460.00,
      "low": 2420.00,
      "close": 2450.50,
      "volume": 4800000
    }
  ]
}
```

---

## Error Response Formats

### 400 Bad Request
```json
{
  "error": "stock_code is required"
}
```

### 401 Unauthorized
```json
{
  "error": "Breeze session token not set. Use /admin/api-session"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to fetch data from Breeze API",
  "details": "Connection timeout"
}
```

---

## CORS Headers (Always Present)

All responses include these CORS headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Proxy-Admin-Key
```

This allows the frontend to make cross-origin requests from:
- `http://localhost:8080` (development)
- `http://34.72.13.202:8082` (VM deployment)
- Any other origin

---

## Verification Command

To verify all endpoints at once:
```bash
cd breeze-proxy
./quick_verify.sh
```

Or run the comprehensive test:
```bash
python3 verify_deployment.py
```

---

## Notes

1. **Session Token**: Must be set daily via the admin endpoint before market data endpoints work
2. **Admin Key**: Required in `X-Proxy-Admin-Key` header for session management
3. **CORS**: Enabled for all origins by default (can be restricted in production)
4. **Health Checks**: Always accessible without authentication
5. **Error Handling**: All errors return JSON with error message

---

## Traffic Flow Confirmed ✅

```
Frontend (localhost:8080 or VM)
    ↓
    | HTTP Request with CORS
    ↓
Breeze Proxy (Cloud Run)
    ↓
    | Validate session
    | Forward to Breeze API
    ↓
ICICI Breeze API
    ↓
    | Return market data
    ↓
Breeze Proxy (Cloud Run)
    ↓
    | Format response
    | Add CORS headers
    ↓
Frontend (receives data)
```

**Status**: ✅ **OPERATIONAL - TRAFFIC CAN FLOW**
