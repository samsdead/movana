param([string]$AwsProfile='dance-app',[string]$Stack='movana-app')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath 'dist/index.html')) { throw 'Build the app before deploying.' }
$stackInfo = aws cloudformation describe-stacks --profile $AwsProfile --region us-east-1 --stack-name $Stack --output json --no-cli-pager | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the deployment stack.' }
$appStack=$stackInfo.Stacks[0]
if ($appStack.StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')) { throw 'The AWS stack is not ready.' }
$values=@{}
foreach ($entry in $appStack.Outputs) { $values[$entry.OutputKey]=$entry.OutputValue }
if ($values.SubscriptionPlan -ne 'FREE' -or $values.SubscriptionStatus -ne 'ACTIVE') { throw 'Refusing deployment: the active Free plan was not verified.' }
$bucket=$values.BucketName
if (-not $bucket.StartsWith('movana-app-assets-')) { throw 'Unexpected bucket name. Review the stack before deploying.' }
aws s3 sync dist "s3://$bucket" --profile $AwsProfile --region us-east-1 --cache-control 'public,max-age=3600' --no-progress --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed.' }
aws s3 cp dist/assets "s3://$bucket/assets" --recursive --profile $AwsProfile --region us-east-1 --cache-control 'public,max-age=31536000,immutable' --no-progress --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Versioned bundle upload failed.' }
foreach ($file in @('index.html','sw.js','manifest.webmanifest')) {
  $contentType = if ($file -eq 'index.html') {'text/html; charset=utf-8'} elseif ($file -eq 'sw.js') {'application/javascript; charset=utf-8'} else {'application/manifest+json'}
  aws s3 cp "dist/$file" "s3://$bucket/$file" --profile $AwsProfile --region us-east-1 --cache-control 'no-cache,max-age=0,must-revalidate' --content-type $contentType --no-progress --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw "Entrypoint upload failed: $file" }
}
$invalidation=aws cloudfront create-invalidation --profile $AwsProfile --distribution-id $values.DistributionId --paths '/*' --query 'Invalidation.Id' --output text --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'CloudFront invalidation failed.' }
Write-Output "Published: $($values.AppUrl)"
Write-Output "Invalidation: $invalidation"
