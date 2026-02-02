# Breeze Proxy Service

A Flask-based proxy service for ICICI Direct's Breeze API, designed to run on Google Cloud Run.

## Architecture

This service acts as a secure proxy between your frontend application and the ICICI Direct Breeze API, handling:
- API authentication and session management
- Secret management via Google Secret Manager
- Market data retrieval (quotes, depth, historical)
- CORS handling for frontend access

## Port Configuration

The service is designed to work in multiple environments:

- **Local Development**: Defaults to port 8081
- **Google Cloud Run**: Uses the `PORT` environment variable (typically 8080)
- **Docker**: Can be configured via `PORT` environment variable

### Why Port 8081 Locally?

Port 8080 is used by the frontend (Vite dev server), so the Breeze proxy uses 8081 to avoid conflicts during local development.

## Endpoints

### Health Checks
- `GET /` - Root health check (for Cloud Run)
- `GET /breeze/health` - Detailed health status with session info

### Admin
- `POST /breeze/admin/api-session` - Set the daily Breeze API session token

### Market Data
- `POST /breeze/quotes` - Get stock quotes
- `POST /breeze/depth` - Get market depth
- `POST /breeze/historical` - Get historical data

## Local Development

### Prerequisites
```bash
pip install -r requirements.txt
```

### Port Configuration

**IMPORTANT: Port 8080 Conflict with Jupyter**

If you're running in a Jupyter environment, port 8080 may already be in use. The Breeze proxy defaults to **port 8081** to avoid this conflict.

**Port Assignment:**
- Frontend: 8080 (Vite dev server)
- Main Backend: 5000 (app.py)
- **Breeze Proxy: 8081** (breeze_proxy_app.py) ← Default to avoid Jupyter conflict

### Starting the Service

**Option 1: Smart Startup Script (Recommended)**

The script automatically finds an available port:
```bash
cd breeze-proxy
./start.sh
```

**Option 2: Direct Python**

Default port (8081):
```bash
python breeze_proxy_app.py
```

Custom port:
```bash
PORT=8082 python breeze_proxy_app.py
```

**Option 3: If Port Conflict Persists**

Kill the process using the port:
```bash
# Find and kill process on port 8081
lsof -ti:8081 | xargs kill -9

# Then start normally
python breeze_proxy_app.py
```

### Set Environment Variables
```bash
# Required for local development (if not using Google Secret Manager)
export BREEZE_API_KEY="your_api_key"
export BREEZE_API_SECRET="your_api_secret"
export BREEZE_PROXY_ADMIN_KEY="your_admin_key"

# For Google Secret Manager (default)
export GCP_PROJECT_ID="919207294606"
```

## Google Cloud Run Deployment

### Prerequisites
1. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
2. Authenticate: `gcloud auth login`
3. Set up secrets in Google Secret Manager:
   - `BREEZE_API_KEY`
   - `BREEZE_API_SECRET`
   - `BREEZE_PROXY_ADMIN_KEY`

### Quick Deploy

Use the deployment script:
```bash
./deploy.sh
```

### Manual Deployment

1. **Build the container:**
```bash
gcloud builds submit --tag gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service
```

2. **Deploy to Cloud Run:**
```bash
gcloud run deploy maia-breeze-proxy-service \
  --image gcr.io/gen-lang-client-0751458856/maia-breeze-proxy-service \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --set-env-vars "GCP_PROJECT_ID=gen-lang-client-0751458856"
```

3. **Get the service URL:**
```bash
gcloud run services describe maia-breeze-proxy-service \
  --region us-central1 \
  --format 'value(status.url)'
```

## Troubleshooting

### Port Already in Use (Error: Address already in use)

If you get a port conflict error:

1. **Check what's using port 8081:**
```bash
lsof -i :8081
# or
netstat -tuln | grep 8081
```

2. **Kill the process:**
```bash
kill -9 <PID>
```

3. **Use a different port:**
```bash
PORT=8082 python breeze_proxy_app.py
```

### Cloud Run Health Check Failing

The service provides two health check endpoints:
- `/` - Returns basic status (recommended for Cloud Run)
- `/breeze/health` - Returns detailed status including session info

Cloud Run expects the service to:
1. Listen on the `PORT` environment variable (not hardcoded)
2. Respond to HTTP requests within 4 seconds
3. Start within 240 seconds

Our configuration handles all of these requirements.

### CORS Issues

The service enables CORS for all origins by default. If you need to restrict origins, modify the CORS configuration in `breeze_proxy_app.py`:

```python
CORS(app, resources={r"/*": {"origins": ["https://your-frontend-domain.com"]}})
```

### Secret Manager Access

If secrets aren't loading:

1. **Check service account permissions:**
```bash
gcloud projects add-iam-policy-binding gen-lang-client-0751458856 \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

2. **Verify secrets exist:**
```bash
gcloud secrets list --project=gen-lang-client-0751458856
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 8081 | Port to listen on (Cloud Run sets this automatically) |
| `GCP_PROJECT_ID` | Yes | 919207294606 | Google Cloud Project ID |
| `BREEZE_API_KEY` | Yes | - | ICICI Breeze API Key (from Secret Manager or env) |
| `BREEZE_API_SECRET` | Yes | - | ICICI Breeze API Secret (from Secret Manager or env) |
| `BREEZE_PROXY_ADMIN_KEY` | Yes | - | Admin key for session management (from Secret Manager or env) |

## Architecture Notes

### Why Use Gunicorn?

For production (Cloud Run), we use Gunicorn instead of Flask's built-in server:
- Better performance and stability
- Handles concurrent requests efficiently
- Required for production deployments

### Why Separate from Main Backend?

The Breeze proxy is separated from the main backend (`app.py`) because:
1. It handles external API connections with different scaling needs
2. Session management is stateful and benefits from persistent instances
3. Allows independent deployment and scaling
4. Provides better isolation for API credentials

## Monitoring

### View Logs
```bash
gcloud logs read --project=gen-lang-client-0751458856 \
  --service=maia-breeze-proxy-service \
  --limit=50
```

### View Metrics
Visit the Cloud Run console:
https://console.cloud.google.com/run/detail/us-central1/maia-breeze-proxy-service

## Related Services

- **Main Backend**: `app.py` (port 5000) - Handles Gemini AI and business logic
- **Frontend**: Vite dev server (port 8080) - React application
- **Breeze Proxy**: This service (port 8081 local, dynamic on Cloud Run) - ICICI API proxy

## Security Considerations

1. **Secrets**: Always use Google Secret Manager for production
2. **CORS**: Configure specific origins for production
3. **Authentication**: The admin key protects session management endpoints
4. **Rate Limiting**: Consider adding rate limiting for production use
