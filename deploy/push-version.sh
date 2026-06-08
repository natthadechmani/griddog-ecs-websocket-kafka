#!/usr/bin/env bash
# Build one service image and push it to ECR under a chosen tag.
# Change TAG below for each build (or pass it as the first argument).
#
# Usage:
#   ./deploy/push-version.sh            # uses the TAG/SERVICE set below
#   ./deploy/push-version.sh v2         # override tag
#   ./deploy/push-version.sh v2 cms-api # override tag + service
set -euo pipefail

# ============ EDIT THESE ============
SERVICE="storefront"     # store-api | cms-api | cms-ui | storefront
TAG="v2"                # <-- change this each build (e.g. v1, v2, baseline, dd)
PUSH_LATEST="true"      # also push :latest pointing at this build
# ====================================

# Optional CLI overrides: arg1 = tag, arg2 = service
[ "${1:-}" ] && TAG="$1"
[ "${2:-}" ] && SERVICE="$2"

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
REPO="griddog-${SERVICE}"
IMAGE="${REGISTRY}/${REPO}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building ${SERVICE}  ->  ${IMAGE}:${TAG}"

# Log in to ECR
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

# Build for Fargate (amd64) and push the chosen tag
docker build --platform linux/amd64 -t "${IMAGE}:${TAG}" "${ROOT}/${SERVICE}"
docker push "${IMAGE}:${TAG}"

# Optionally also move :latest to this build
if [ "$PUSH_LATEST" = "true" ]; then
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:latest"
  docker push "${IMAGE}:latest"
fi

echo "==> Done: ${IMAGE}:${TAG}$( [ "$PUSH_LATEST" = "true" ] && echo "  (and :latest)" )"
