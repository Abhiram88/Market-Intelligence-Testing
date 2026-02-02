# Breeze Proxy - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     User / Browser                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ HTTP/HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Frontend (React/Vite)                         │
│                   Port: 8080 (local)                            │
│                   http://34.72.13.202:8082/ (VM)                │
└────────────┬──────────────────────────────┬─────────────────────┘
             │                              │
             │ API Calls                    │ API Calls
             ▼                              ▼
┌─────────────────────────┐   ┌──────────────────────────────────┐
│   Main Backend          │   │   Breeze Proxy (This Service)   │
│   (app.py)              │   │   Port: 8081 (local)            │
│   Port: 5000            │◄──┤   Port: 8080 (Cloud Run)        │
│                         │   │   CORS Enabled                  │
└─────────────────────────┘   └──────────┬───────────────────────┘
             │                           │
             │                           │ Breeze API Calls
             ▼                           ▼
┌─────────────────────────┐   ┌──────────────────────────────────┐
│   Google Services       │   │   ICICI Direct Breeze API       │
│   - Gemini AI           │   │   - Market Quotes               │
│   - Supabase            │   │   - Market Depth                │
│   - Secret Manager      │   │   - Historical Data             │
└─────────────────────────┘   └──────────────────────────────────┘
```

## Port Configuration

### Local Development

```
┌──────────────┬─────────────────────────┬──────────────────────┐
│  Service     │  Port                   │  URL                 │
├──────────────┼─────────────────────────┼──────────────────────┤
│  Frontend    │  8080                   │  localhost:8080      │
│  Backend     │  5000                   │  localhost:5000      │
│  Breeze      │  8081                   │  localhost:8081      │
└──────────────┴─────────────────────────┴──────────────────────┘
```

### Google Cloud Run

```
┌──────────────┬─────────────────────────────────────────────────┐
│  Service     │  URL                                            │
├──────────────┼─────────────────────────────────────────────────┤
│  Breeze      │  https://maia-breeze-proxy-service-            │
│  Proxy       │  919207294606.us-central1.run.app               │
└──────────────┴─────────────────────────────────────────────────┘
```

## Request Flow

### 1. Market Data Request Flow

```
Frontend
   │
   │ POST /api/market/quote {symbol: "RELIANCE"}
   ▼
Main Backend (app.py)
   │
   │ Maps symbol: RELIANCE → RELIANCEIND
   │ POST /breeze/quotes
   ▼
Breeze Proxy (breeze_proxy_app.py)
   │
   │ Validates session
   │ Calls Breeze API
   ▼
ICICI Direct Breeze API
   │
   │ Returns market data
   ▼
Breeze Proxy
   │
   │ Formats response
   ▼
Main Backend
   │
   │ Returns to frontend
   ▼
Frontend (displays data)
```

### 2. Session Management Flow

```
User
   │
   │ Opens API Settings in UI
   │ Enters session token
   ▼
Frontend
   │
   │ POST /breeze/admin/api-session
   │ Headers: X-Proxy-Admin-Key
   │ Body: {api_session: "token"}
   ▼
Breeze Proxy
   │
   │ Validates admin key
   │ Calls Breeze API to generate session
   │ Stores session token in memory
   ▼
User (session active for the day)
```

## Component Responsibilities

### Breeze Proxy (This Service)

**Purpose**: Secure proxy between frontend and ICICI Breeze API

**Responsibilities**:
- Authenticate with Breeze API using API key/secret
- Manage daily session tokens
- Provide market data endpoints (quotes, depth, historical)
- Handle CORS for frontend access
- Protect API credentials using Secret Manager
- Rate limiting and error handling

**Why Separate?**:
1. Security: API credentials isolated from main backend
2. Stateful: Session management requires persistent instances
3. Scaling: Can scale independently based on API load
4. Isolation: Breeze API failures don't affect main backend

### Main Backend (app.py)

**Purpose**: Business logic and AI processing

**Responsibilities**:
- Gemini AI integration for market analysis
- Symbol mapping (NSE → Breeze codes)
- Data persistence to Supabase
- REG30 event processing
- Coordinate between frontend and Breeze proxy

### Frontend

**Purpose**: User interface

**Responsibilities**:
- Display market data and analytics
- User interactions
- API session management UI
- Real-time updates and charts

## Cloud Run Configuration

### Environment Variables

```yaml
Required:
  - PORT: Set automatically by Cloud Run (8080)
  - GCP_PROJECT_ID: Google Cloud Project ID

Optional (from Secret Manager):
  - BREEZE_API_KEY: ICICI Breeze API key
  - BREEZE_API_SECRET: ICICI Breeze API secret
  - BREEZE_PROXY_ADMIN_KEY: Admin key for session management
```

### Service Configuration

```yaml
Platform: managed
Region: us-central1
Memory: 512Mi
CPU: 1
Concurrency: 80 (default)
Timeout: 300s (5 minutes)
Min instances: 0 (scale to zero)
Max instances: 10
```

### Health Checks

Cloud Run performs these checks:

1. **Startup Check**: 
   - Endpoint: `GET /`
   - Timeout: 240 seconds
   - Expected: 200 OK

2. **Liveness Check**:
   - Endpoint: `GET /`
   - Frequency: Every 10 seconds
   - Expected: 200 OK

3. **Readiness Check**:
   - Endpoint: `GET /`
   - Determines if instance receives traffic

## Security Architecture

### Secrets Management

```
Secret Manager
   │
   │ Secrets stored encrypted
   ├─ BREEZE_API_KEY
   ├─ BREEZE_API_SECRET
   └─ BREEZE_PROXY_ADMIN_KEY
   │
   │ Retrieved at runtime
   ▼
Breeze Proxy
   │
   │ Cached in memory
   └─ Used for API authentication
```

### API Key Flow

```
1. Frontend sends request
   │
   ▼
2. Breeze Proxy validates admin key
   │
   ▼
3. If valid, uses stored API key/secret
   │
   ▼
4. Authenticates with Breeze API
   │
   ▼
5. Returns data to frontend
```

## CORS Configuration

```python
# Allow all origins (development)
CORS(app, resources={r"/*": {"origins": "*"}})

# Restrict to specific origins (production)
CORS(app, resources={r"/*": {
    "origins": [
        "https://your-frontend.com",
        "http://localhost:8080"
    ]
}})
```

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

### HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Missing required parameters |
| 401 | Unauthorized | Invalid admin key or session |
| 404 | Not Found | No data returned from Breeze |
| 500 | Server Error | Internal server or Breeze API error |
| 502 | Bad Gateway | Failed to connect to Breeze API |

## Monitoring

### Key Metrics to Monitor

1. **Request Rate**: Requests per minute
2. **Response Time**: P50, P95, P99 latencies
3. **Error Rate**: 4xx and 5xx errors
4. **CPU Usage**: Should stay under 80%
5. **Memory Usage**: Should stay under 400Mi
6. **Instance Count**: Active instances

### Logging

Logs include:
- Startup information (port, endpoints)
- API calls (stock code, operation)
- Errors (with stack traces)
- Session management (creation, regeneration)

## Performance

### Expected Latency

| Endpoint | Expected Latency |
|----------|------------------|
| GET / | < 100ms |
| GET /breeze/health | < 100ms |
| POST /breeze/quotes | 200-500ms |
| POST /breeze/depth | 200-500ms |
| POST /breeze/historical | 500-2000ms |

### Optimization Strategies

1. **Caching**: Symbol mappings cached in memory
2. **Connection Pooling**: Reuse HTTP connections
3. **Gunicorn Workers**: Multiple threads per worker
4. **Min Instances**: Keep 1 instance warm in production

## Deployment Pipeline

```
Developer
   │
   │ git push
   ▼
GitHub Repository
   │
   │ Manual deployment
   ▼
./deploy.sh
   │
   │ gcloud builds submit
   ▼
Cloud Build
   │
   │ Build Docker image
   ▼
Container Registry
   │
   │ gcloud run deploy
   ▼
Cloud Run
   │
   │ Deploy new revision
   │ Health check passes
   │ Route traffic
   ▼
Live Service
```

## Disaster Recovery

### Rollback Procedure

```bash
# List revisions
gcloud run revisions list --service=maia-breeze-proxy-service

# Rollback to previous
gcloud run services update-traffic maia-breeze-proxy-service \
  --to-revisions=PREVIOUS_REVISION=100
```

### Backup Strategy

- **Code**: Version controlled in GitHub
- **Secrets**: Stored in Secret Manager (versioned)
- **Configuration**: Infrastructure as code
- **Sessions**: Ephemeral, no backup needed

## Testing Strategy

### Unit Tests

```bash
python test_cloudrun.py
```

Tests:
- Port configuration
- Health endpoints
- CORS configuration
- All API endpoints

### Integration Tests

```bash
# Local
PORT=8081 python breeze_proxy_app.py

# Test
curl http://localhost:8081/
```

### Production Tests

```bash
# Health check
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/

# Breeze health
curl https://maia-breeze-proxy-service-919207294606.us-central1.run.app/breeze/health
```

## Scalability

### Horizontal Scaling

- Cloud Run auto-scales based on:
  - Request volume
  - CPU usage
  - Memory usage
  - Concurrency

### Vertical Scaling

Adjust resources if needed:

```bash
gcloud run services update maia-breeze-proxy-service \
  --memory 1Gi \
  --cpu 2
```

### Connection Limits

- Breeze API: Rate limited by ICICI
- Cloud Run: Max 10 instances (configurable)
- Per instance: 80 concurrent requests (default)

## Cost Considerations

### Pricing Factors

1. **Request Count**: Billed per million requests
2. **CPU Time**: Billed per vCPU-second
3. **Memory**: Billed per GiB-second
4. **Networking**: Egress data transfer

### Optimization

- Use min-instances=0 (scale to zero when idle)
- Right-size CPU and memory (512Mi sufficient)
- Cache frequently accessed data
- Monitor and optimize slow endpoints

## Future Enhancements

Potential improvements:
1. Redis cache for market data
2. Rate limiting per user
3. Authentication beyond admin key
4. Metrics API for monitoring
5. Batch quote requests
6. WebSocket for real-time data
7. Circuit breaker for Breeze API
8. Request queue for rate limiting
