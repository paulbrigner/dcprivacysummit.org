#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  CLOUDFRONT_DISTRIBUTION_ID
  DEPLOY_SHA
  S3_BUCKET
  SITE_URL
)

for variable_name in "${required_variables[@]}"; do
  if [ -z "${!variable_name:-}" ]; then
    echo "Missing required variable: $variable_name" >&2
    exit 1
  fi
done

aws s3 sync . "s3://${S3_BUCKET}" \
  --delete \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude "aws/*" \
  --cache-control "no-cache"

if [ -d images/optimized ]; then
  aws s3 cp images/optimized "s3://${S3_BUCKET}/images/optimized" \
    --recursive \
    --cache-control "public,max-age=31536000,immutable"
fi

printf '%s\n' "$DEPLOY_SHA" | aws s3 cp - \
  "s3://${S3_BUCKET}/.well-known/deployment-sha" \
  --cache-control "no-cache" \
  --content-type "text/plain"

invalidation_id=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

aws cloudfront wait invalidation-completed \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --id "$invalidation_id"

expected_index_hash=$(sha256sum index.html | cut -d ' ' -f 1)
verified=false

for attempt in {1..12}; do
  cache_bust="${DEPLOY_SHA}-${GITHUB_RUN_ATTEMPT:-1}-${attempt}"
  live_sha=$(curl --fail --silent --show-error --location \
    "${SITE_URL}/.well-known/deployment-sha?v=${cache_bust}" || true)
  live_index_hash=$(curl --fail --silent --show-error --location \
    "${SITE_URL}/index.html?v=${cache_bust}" | sha256sum | cut -d ' ' -f 1 || true)

  if [ "$live_sha" = "$DEPLOY_SHA" ] && [ "$live_index_hash" = "$expected_index_hash" ]; then
    verified=true
    break
  fi

  sleep 5
done

if [ "$verified" != "true" ]; then
  echo "Live verification did not match deployment $DEPLOY_SHA." >&2
  exit 1
fi

{
  echo "### Deployment verified"
  echo ""
  echo "- Commit: \`$DEPLOY_SHA\`"
  echo "- Site: $SITE_URL"
  echo "- Index SHA-256: \`$expected_index_hash\`"
} >> "$GITHUB_STEP_SUMMARY"
