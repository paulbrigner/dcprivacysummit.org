#!/usr/bin/env bash
set -euo pipefail

profile="${AWS_PROFILE:-zodldashboard}"
region="${AWS_REGION:-us-east-1}"
stack_name="${STACK_NAME:-dcps-contact-form}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if aws cloudformation describe-stacks --stack-name "$stack_name" --profile "$profile" --region "$region" >/dev/null 2>&1; then
  hmac_secret="$(aws lambda get-function-configuration \
    --function-name contact_dcps_v2 \
    --profile "$profile" \
    --region "$region" \
    --query 'Environment.Variables.HMAC_SECRET' \
    --output text)"
else
  hmac_secret="$(openssl rand -base64 48)"
fi

aws cloudformation deploy \
  --template-file "$script_dir/template.yml" \
  --stack-name "$stack_name" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "HmacSecret=$hmac_secret" \
  --profile "$profile" \
  --region "$region" \
  --no-fail-on-empty-changeset

package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT
cp "$script_dir/index.mjs" "$package_dir/index.mjs"
cp "$script_dir/package.json" "$script_dir/package-lock.json" "$package_dir/"
(cd "$package_dir" && npm ci --omit=dev --ignore-scripts >/dev/null)
(cd "$package_dir" && zip -qr function.zip index.mjs package.json package-lock.json node_modules)

aws lambda update-function-code \
  --function-name contact_dcps_v2 \
  --zip-file "fileb://$package_dir/function.zip" \
  --architectures arm64 \
  --profile "$profile" \
  --region "$region" \
  --query '{FunctionName:FunctionName,CodeSha256:CodeSha256,LastModified:LastModified}'

aws lambda wait function-updated \
  --function-name contact_dcps_v2 \
  --profile "$profile" \
  --region "$region"

aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --profile "$profile" \
  --region "$region" \
  --query 'Stacks[0].Outputs' \
  --output table
