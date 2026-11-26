param([string]$AwsProfile='dance-app',[string]$Stack='movana-app')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
node scripts/verify-release.mjs
if ($LASTEXITCODE -ne 0) { throw 'Build and verify the complete release before deploying.' }
$stackInfo = aws cloudformation describe-stacks --profile $AwsProfile --region us-east-1 --stack-name $Stack --output json --no-cli-pager | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the deployment stack.' }
$appStack=$stackInfo.Stacks[0]
if ($appStack.StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')) { throw 'The AWS stack is not ready.' }
$values=@{}
foreach ($entry in $appStack.Outputs) { $values[$entry.OutputKey]=$entry.OutputValue }
if ($values.SubscriptionPlan -ne 'FREE' -or $values.SubscriptionStatus -ne 'ACTIVE') { throw 'Refusing deployment: the active Free plan was not verified.' }
$bucket=$values.BucketName
if (-not $bucket.StartsWith('movana-app-assets-')) { throw 'Unexpected bucket name. Review the stack before deploying.' }
$versioning = aws s3api get-bucket-versioning --bucket $bucket --query Status --output text --profile $AwsProfile --region us-east-1 --no-cli-pager
if ($LASTEXITCODE -ne 0 -or $versioning -ne 'Enabled') { throw 'Enable asset bucket versioning before publishing.' }
aws s3 sync dist/assets "s3://$bucket/assets" --profile $AwsProfile --region us-east-1 --cache-control 'public,max-age=31536000,immutable' --no-progress --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Versioned bundle upload failed.' }
aws s3 sync dist "s3://$bucket" --exclude 'assets/*' --exclude 'mediapipe/*' --exclude 'models/*' --exclude 'index.html' --exclude 'sw.js' --exclude 'manifest.webmanifest' --profile $AwsProfile --region us-east-1 --cache-control 'public,max-age=3600' --no-progress --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Static asset upload failed.' }
foreach ($file in @('manifest.webmanifest','index.html','sw.js')) {
  $contentType = if ($file -eq 'index.html') {'text/html; charset=utf-8'} elseif ($file -eq 'sw.js') {'application/javascript; charset=utf-8'} else {'application/manifest+json'}
  $releaseVersion = aws s3api put-object --bucket $bucket --key $file --body "dist/$file" --profile $AwsProfile --region us-east-1 --cache-control 'no-cache,max-age=0,must-revalidate' --content-type $contentType --query VersionId --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseVersion) -or $releaseVersion -in @('None','null')) { throw "Entrypoint upload or version recording failed: $file" }
  Write-Output "Published $file version $releaseVersion"
}
$invalidation=aws cloudfront create-invalidation --profile $AwsProfile --distribution-id $values.DistributionId --paths '/*' --query 'Invalidation.Id' --output text --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'CloudFront invalidation failed.' }
Write-Output "Published: $($values.AppUrl)"
Write-Output "Invalidation: $invalidation"
