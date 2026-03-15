#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="20260314_201134_untitled"
BUCKET="ama-output-geminiliveagent-489401"
LOCAL_DIR="$(dirname "$0")/backend/output/${PROJECT_ID}"

echo "Uploading ${PROJECT_ID} to gs://${BUCKET}/${PROJECT_ID}/ ..."
gcloud storage cp -r "${LOCAL_DIR}" "gs://${BUCKET}/"
echo "✅ Done: gs://${BUCKET}/${PROJECT_ID}/"
