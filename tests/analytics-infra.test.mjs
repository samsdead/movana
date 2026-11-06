import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const template = JSON.parse(await readFile(new URL('../aws-template.json', import.meta.url), 'utf8'));
const resources = template.Resources;
const distribution = resources.Distribution.Properties.DistributionConfig;

test('analytics preserves the Free subscription and established WAF rate rule', () => {
  assert.equal(resources.FreeSubscription.Properties.PlanTier, 'FREE');
  assert.equal(resources.FreeSubscription.Properties.UsageLevel, 'DEFAULT');
  assert.equal(resources.FreeSubscription.Properties.PlanFamily, 'CloudFront');
  assert.ok(distribution.CacheBehaviors.length + 1 <= 5);
  // The Free plan rejected a second URI-scoped rate rule during deployment.
  // Keep the known-working IP-only rule; its limit includes /events and assets.
  assert.equal(resources.WebAcl.Properties.Rules.length, 1);
  assert.equal(distribution.DefaultCacheBehavior.TargetOriginId, 'PrivateAssets');
  const behavior = distribution.CacheBehaviors.find(item => item.PathPattern === '/events');
  assert.equal(behavior.TargetOriginId, 'AnonymousEvents');
  assert.equal(behavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  assert.equal(behavior.OriginRequestPolicyId, 'b689b0a8-53d0-40ab-baf2-68738e2966ac');
  assert.equal(behavior.ViewerProtocolPolicy, 'https-only');
  assert.ok(behavior.AllowedMethods.includes('POST'));
  assert.deepEqual(behavior.CachedMethods, ['GET', 'HEAD']);
  assert.deepEqual(behavior.FunctionAssociations.filter(item => item.EventType === 'viewer-response'), distribution.DefaultCacheBehavior.FunctionAssociations);
  assert.deepEqual(behavior.FunctionAssociations.find(item => item.EventType === 'viewer-request'), {
    EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': ['AnalyticsRequestGuard', 'FunctionMetadata.FunctionARN'] },
  });
  const limit = resources.WebAcl.Properties.Rules[0];
  assert.equal(limit.Name, 'RequestRateLimit');
  assert.deepEqual(limit.Statement, {
    RateBasedStatement: { AggregateKeyType: 'IP', Limit: 2000, EvaluationWindowSec: 300 },
  });
  assert.equal(limit.VisibilityConfig.SampledRequestsEnabled, false);
});

test('edge validation rejects malformed event requests before Lambda and strips unrelated data', () => {
  const source = resources.AnalyticsRequestGuard.Properties.FunctionCode['Fn::Sub'];
  const handler = vm.runInNewContext(`${source.replaceAll('${AnalyticsEnabled}', 'true')}; handler`);
  function event(changes = {}, headers = {}) {
    return { request: { method: 'POST', uri: '/events', querystring: { email: { value: 'not-needed' } },
      cookies: { unwanted: { value: 'not-needed' } }, headers: {
        origin: { value: 'https://d2cxbgxgnz3xxl.cloudfront.net' },
        'content-type': { value: 'application/json' }, 'content-length': { value: '18' },
        'x-amz-content-sha256': { value: 'a'.repeat(64) },
        authorization: { value: 'unwanted' }, referer: { value: 'unwanted' }, ...headers,
      }, ...changes } };
  }
  const accepted = handler(event());
  assert.equal(accepted.method, 'POST');
  assert.equal(Object.keys(accepted.cookies).length, 0);
  assert.equal(Object.keys(accepted.querystring).length, 0);
  assert.equal(accepted.headers.authorization, undefined);
  assert.equal(accepted.headers.referer, undefined);
  assert.equal(accepted.headers['x-amz-content-sha256'].value, 'a'.repeat(64));
  assert.equal(handler(event({ method: 'GET' })).statusCode, 405);
  for (const origin of ['', 'null', 'https://attacker.invalid', 'https://d2cxbgxgnz3xxl.cloudfront.net.attacker.invalid']) {
    assert.equal(handler(event({}, { origin: { value: origin } })).statusCode, 403);
  }
  assert.equal(handler(event({}, { origin: { value: 'https://d2cxbgxgnz3xxl.cloudfront.net', multiValue: [{ value: 'https://attacker.invalid' }] } })).statusCode, 403);
  assert.equal(handler(event({}, { 'content-type': { value: 'text/plain' } })).statusCode, 415);
  assert.equal(handler(event({}, { 'content-type': { value: 'application/json; charset=utf-8' } })).method, 'POST');
  for (const length of ['0', '-1', '513', '1000000', '10junk', '18,18']) {
    assert.equal(handler(event({}, { 'content-length': { value: length } })).statusCode, 413);
  }
  const noLength = event(); delete noLength.request.headers['content-length'];
  assert.equal(handler(noLength).method, 'POST');
  for (const digest of ['', 'a'.repeat(63), 'g'.repeat(64)]) {
    assert.equal(handler(event({}, { 'x-amz-content-sha256': { value: digest } })).statusCode, 400);
  }
  const paused = vm.runInNewContext(`${source.replaceAll('${AnalyticsEnabled}', 'false')}; handler`)(event());
  assert.equal(paused.statusCode, 204);
  assert.equal(paused.headers['cache-control'].value, 'no-store');
  assert.equal(template.Parameters.AnalyticsEnabled.Default, 'false');
  assert.deepEqual(resources.AnalyticsCollector.Properties.Environment.Variables.ANALYTICS_ENABLED, { Ref: 'AnalyticsEnabled' });
  assert.deepEqual(resources.AnalyticsDashboardFunction.Properties.Environment.Variables.ANALYTICS_ENABLED, { Ref: 'AnalyticsEnabled' });
});

test('camera is first-party only and microphone access is disabled', () => {
  const handler = vm.runInNewContext(`${resources.PrivacyHeaders.Properties.FunctionCode}; handler`);
  const response = handler({ response: { headers: {} } });
  assert.match(response.headers['permissions-policy'].value, /camera=\(self\)/);
  assert.match(response.headers['permissions-policy'].value, /microphone=\(\)/);
  assert.match(response.headers['content-security-policy'].value, /frame-ancestors 'none'/);
  assert.match(response.headers['content-security-policy'].value, /connect-src 'self'/);
});

test('collector origin requires signed CloudFront requests from this distribution only', () => {
  assert.equal(resources.AnalyticsUrl.Properties.AuthType, 'AWS_IAM');
  assert.equal(Object.values(resources).filter(item => item.Type === 'AWS::Lambda::Url').length, 1);
  assert.deepEqual(resources.AnalyticsOriginAccess.Properties.OriginAccessControlConfig, {
    Name: { 'Fn::Sub': '${AppName}-${AWS::AccountId}-events' },
    OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always', SigningProtocol: 'sigv4',
  });
  const origin = distribution.Origins.find(item => item.Id === 'AnonymousEvents');
  assert.equal(origin.CustomOriginConfig.OriginProtocolPolicy, 'https-only');
  assert.deepEqual(origin.OriginAccessControlId, { Ref: 'AnalyticsOriginAccess' });
  assert.deepEqual(origin.DomainName, { 'Fn::Select': [2, { 'Fn::Split': ['/', { 'Fn::GetAtt': ['AnalyticsUrl', 'FunctionUrl'] }] }] });
  for (const id of ['AnalyticsUrlPermission', 'AnalyticsInvokePermission']) {
    const permission = resources[id].Properties;
    assert.equal(permission.Principal, 'cloudfront.amazonaws.com');
    assert.deepEqual(permission.SourceArn, { 'Fn::Sub': 'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}' });
    assert.deepEqual(permission.FunctionName, { Ref: 'AnalyticsCollector' });
  }
  assert.equal(resources.AnalyticsUrlPermission.Properties.Action, 'lambda:InvokeFunctionUrl');
  assert.equal(resources.AnalyticsUrlPermission.Properties.FunctionUrlAuthType, 'AWS_IAM');
  assert.equal(resources.AnalyticsInvokePermission.Properties.Action, 'lambda:InvokeFunction');
  assert.equal(resources.AnalyticsInvokePermission.Properties.InvokedViaFunctionUrl, true);
});

test('analytics has bounded provisioned capacity, expiring aggregates and no request logs', () => {
  const table = resources.AnalyticsTable;
  assert.equal(table.DeletionPolicy, 'Retain');
  assert.equal(table.UpdateReplacePolicy, 'Retain');
  assert.equal(table.Properties.BillingMode, 'PROVISIONED');
  assert.deepEqual(table.Properties.ProvisionedThroughput, { ReadCapacityUnits: 2, WriteCapacityUnits: 1 });
  assert.deepEqual(table.Properties.TimeToLiveSpecification, { AttributeName: 'expires', Enabled: true });
  // false selects free AWS-owned encryption; true selects metered KMS encryption.
  assert.equal(table.Properties.SSESpecification.SSEEnabled, false);
  assert.equal(table.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled, false);
  assert.equal(table.Properties.StreamSpecification, undefined);
  assert.equal(distribution.Logging, undefined);
  assert.ok(Object.values(resources).every(item => !['AWS::Logs::LogGroup', 'AWS::WAFv2::LoggingConfiguration', 'AWS::ApplicationAutoScaling::ScalableTarget'].includes(item.Type)));
  for (const [id, timeout] of [['AnalyticsCollector', 3], ['AnalyticsDashboardFunction', 10]]) {
    const fn = resources[id].Properties;
    assert.equal(fn.MemorySize, 128);
    assert.equal(fn.Timeout, timeout);
    // This account's regional concurrency quota is 10; reservations require 100 unreserved slots.
    assert.equal(fn.ReservedConcurrentExecutions, undefined);
  }
});

test('collector can only increment this table; dashboard can only query it', () => {
  for (const [roleId, action] of [['AnalyticsCollectorRole', 'dynamodb:UpdateItem'], ['AnalyticsDashboardRole', 'dynamodb:Query']]) {
    const role = resources[roleId].Properties;
    assert.equal(role.ManagedPolicyArns, undefined);
    assert.equal(role.Policies.length, 1);
    assert.deepEqual(role.Policies[0].PolicyDocument.Statement, [{
      Effect: 'Allow', Action: [action], Resource: { 'Fn::GetAtt': ['AnalyticsTable', 'Arn'] },
    }]);
    assert.deepEqual(role.AssumeRolePolicyDocument.Statement, [{
      Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole',
    }]);
  }
});

test('private dashboard uses the read-only widget and only three built-in CDN metrics', () => {
  assert.equal(resources.UsageDashboard.Properties.DashboardName, 'Movana-Usage');
  const dashboard = JSON.parse(resources.UsageDashboard.Properties.DashboardBody['Fn::Sub']);
  const widget = dashboard.widgets.find(item => item.type === 'custom');
  assert.equal(widget.properties.endpoint, '${AnalyticsDashboardFunction.Arn}');
  const metrics = dashboard.widgets.filter(item => item.type === 'metric').flatMap(item => item.properties.metrics);
  assert.deepEqual(metrics.map(metric => metric.slice(0, 2)), [
    ['AWS/CloudFront', 'Requests'], ['AWS/CloudFront', 'BytesDownloaded'], ['AWS/CloudFront', '5xxErrorRate'],
  ]);
  assert.ok(metrics.every(metric => metric[3] === '${Distribution}' && metric[5] === 'Global'));
  assert.ok(Object.values(resources).filter(item => item.Type === 'AWS::Lambda::Permission')
    .every(item => item.Properties.FunctionName.Ref === 'AnalyticsCollector'));
});

test('CloudFormation inline Lambda sources match the reviewed Python files', async () => {
  for (const [id, file] of [['AnalyticsCollector', 'collector.py'], ['AnalyticsDashboardFunction', 'dashboard.py']]) {
    const source = await readFile(new URL(`../analytics/${file}`, import.meta.url), 'utf8');
    assert.equal(resources[id].Properties.Code.ZipFile, source.replaceAll('\r\n', '\n'), 'Run node scripts/prepare-analytics.mjs after Python edits');
  }
});
