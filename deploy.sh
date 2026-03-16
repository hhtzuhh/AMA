#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROJECT_ID="geminiliveagent-489401"
REGION="us-central1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ama-backend/ama-api:latest"

echo "=== [0/5] Push GEMINI_API_KEY to Secret Manager ==="
gcloud services enable secretmanager.googleapis.com --project="${PROJECT_ID}" --quiet
if gcloud secrets describe gemini-api-key --project="${PROJECT_ID}" &>/dev/null; then
  echo -n "${GEMINI_API_KEY}" | gcloud secrets versions add gemini-api-key \
    --data-file=- --project="${PROJECT_ID}"
else
  echo -n "${GEMINI_API_KEY}" | gcloud secrets create gemini-api-key \
    --data-file=- --replication-policy=automatic --project="${PROJECT_ID}"
fi

echo "=== [1/5] Terraform: APIs + Artifact Registry (pre-image) ==="
cd infra
terraform init -upgrade
terraform apply \
  -target=google_project_service.apis \
  -target=google_artifact_registry_repository.backend \
  -auto-approve
cd ..

# Check if Cloud Run service already exists (i.e. not first deploy)
FIRST_DEPLOY=true
if gcloud run services describe ama-api --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  FIRST_DEPLOY=false
  CLOUD_RUN_URL=$(gcloud run services describe ama-api \
    --region="${REGION}" --project="${PROJECT_ID}" \
    --format="value(status.url)")
  echo "Existing Cloud Run URL: ${CLOUD_RUN_URL}"
fi

echo "=== [2/5] Build frontend ==="
cd frontend
if [ "${FIRST_DEPLOY}" = "true" ]; then
  VITE_API_URL="" npx vite build   # URL unknown yet — will be corrected in step 5
else
  VITE_API_URL="${CLOUD_RUN_URL}" npx vite build
fi
cd ..

echo "=== [3/5] Build & push Docker image via Cloud Build ==="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
gcloud builds submit . \
  --tag "$IMAGE" \
  --machine-type=e2-highcpu-8

echo "=== [4/5] Terraform: full apply (Cloud Run + IAM + GCS) ==="
cd infra
terraform apply -auto-approve
cd ..

# Get the real URL from gcloud — Terraform state can be stale
REAL_URL=$(gcloud run services describe ama-api \
  --region="${REGION}" --project="${PROJECT_ID}" \
  --format="value(status.url)")
echo "Cloud Run URL: ${REAL_URL}"

# Only do a second build if the URL changed (first deploy or URL mismatch)
if [ "${FIRST_DEPLOY}" = "true" ] || [ "${REAL_URL}" != "${CLOUD_RUN_URL:-}" ]; then
  echo "=== [5/5] URL changed — rebuild frontend with correct URL ==="
  cd frontend
  VITE_API_URL="${REAL_URL}" npx vite build
  cd ..
  gcloud builds submit . --tag "$IMAGE" --machine-type=e2-highcpu-8
  gcloud run services update ama-api \
    --region="${REGION}" --image="${IMAGE}" --quiet
else
  echo "=== [5/5] URL unchanged — updating Cloud Run image ==="
  gcloud run services update ama-api \
    --region="${REGION}" --image="${IMAGE}" --quiet
fi

CLOUD_RUN_URL="${REAL_URL}"

echo ""
echo "✅ Done!"
echo "   App    : ${CLOUD_RUN_URL}"
echo "   Health : ${CLOUD_RUN_URL}/api/health"
