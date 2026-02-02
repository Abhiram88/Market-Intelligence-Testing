#!/bin/bash

# Breeze Proxy Cloud Run Deployment Script
# This script builds and deploys the Breeze Proxy service to Google Cloud Run

set -e  # Exit on error

# Configuration
PROJECT_ID="gen-lang-client-0751458856"
SERVICE_NAME="maia-breeze-proxy-service"
REGION="us-central1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "================================================"
echo "Breeze Proxy - Cloud Run Deployment"
echo "================================================"
echo ""
echo "Project ID: ${PROJECT_ID}"
echo "Service Name: ${SERVICE_NAME}"
echo "Region: ${REGION}"
echo "Image: ${IMAGE_NAME}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "ERROR: gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set the project
echo "Setting GCP project..."
gcloud config set project ${PROJECT_ID}

# Build the container image
echo ""
echo "Building container image..."
gcloud builds submit --tag ${IMAGE_NAME}

# Deploy to Cloud Run
echo ""
echo "Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID}"

echo ""
echo "================================================"
echo "Deployment Complete!"
echo "================================================"
echo ""
echo "Service URL:"
gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)'
echo ""
echo "To view logs:"
echo "  gcloud logs read --project=${PROJECT_ID} --service=${SERVICE_NAME}"
echo ""
echo "To test the health endpoint:"
echo "  curl \$(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)')"
echo ""
