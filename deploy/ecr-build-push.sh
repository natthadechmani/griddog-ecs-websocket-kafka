#!/usr/bin/env bash
# Build and push all 4 gridDog images to ECR.
# Prereqs: aws cli configured, docker running, ECR repos created (see runbook.md).
#
# Usage:
#   AWS_ACCOUNT_ID=123456789012 AWS_REGION=us-east-1 ./deploy/ecr-build-push.sh
set -euo pipefail

: "${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID}"
: "${AWS_REGION:?set AWS_REGION}"
TAG="${TAG:-latest}"

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# service_dir -> ecr_repo_name
SERVICES=(
  "store-api:griddog-store-api"
  "cms-api:griddog-cms-api"
  "storefront:griddog-storefront"
  "cms-ui:griddog-cms-ui"
)

echo "Logging in to ECR ${REGISTRY} ..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

for entry in "${SERVICES[@]}"; do
  dir="${entry%%:*}"
  repo="${entry##*:}"
  image="${REGISTRY}/${repo}:${TAG}"
  echo "==> Building ${dir} -> ${image}"
  docker build --platform linux/amd64 -t "${image}" "${ROOT}/${dir}"
  docker push "${image}"
done

echo "Done. Pushed images with tag '${TAG}'."
