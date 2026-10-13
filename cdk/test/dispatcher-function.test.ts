import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { DispatcherFunction } from '../lib/constructs/dispatcher-function';
import { SCENARIOS } from '../lib/scenarios';
import { testStack } from './helpers';

function synth(scenarioId: string): Template {
  const scenario = SCENARIOS.find(s => s.id === scenarioId)!;
  const stack = testStack();
  const scope = new Construct(stack, scenarioId);
  const source = new sqs.Queue(scope, 'Source');
  const stateMachine = new sfn.StateMachine(scope, 'Workflow', {
    stateMachineType: scenario.invocation === 'sync' ? sfn.StateMachineType.EXPRESS : sfn.StateMachineType.STANDARD,
    definitionBody: sfn.DefinitionBody.fromChainable(new sfn.Pass(scope, 'Pass')),
  });
  new DispatcherFunction(scope, 'Dispatcher', { scenario, source, stateMachine });
  return Template.fromStack(stack);
}

/** All actions in the policies of the dispatcher's role. */
function dispatcherActions(template: Template): string[] {
  const fn = Object.values(template.findResources('AWS::Lambda::Function'))[0];
  const roleId = fn.Properties.Role['Fn::GetAtt'][0];
  const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter(policy =>
    policy.Properties.Roles.some((role: { Ref: string }) => role.Ref === roleId),
  );
  assert.ok(policies.length > 0, 'dispatcher role has no policy');
  return policies.flatMap(policy =>
    policy.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) => [s.Action].flat()),
  );
}

describe('DispatcherFunction', () => {
  it('L1 starts one Standard execution per record', () => {
    synth('L1').hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dispatcher.start_async.handler',
      Runtime: 'python3.14',
      Timeout: 60,
      Environment: { Variables: { START_MODE: 'per-record', STATE_MACHINE_ARN: { Ref: Match.stringLikeRegexp('^L1Workflow') } } },
    });
  });

  it('L2 starts one Standard execution with the whole batch', () => {
    synth('L2').hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dispatcher.start_async.handler',
      Environment: { Variables: { START_MODE: 'batch' } },
    });
  });

  it('L3 starts one sync Express execution per record, one after the other', () => {
    synth('L3').hasResourceProperties('AWS::Lambda::Function', { Handler: 'dispatcher.start_sync_sequential.handler' });
  });

  it('L4 starts one sync Express execution per record, in parallel', () => {
    synth('L4').hasResourceProperties('AWS::Lambda::Function', { Handler: 'dispatcher.start_sync_parallel.handler' });
  });

  it('L5 starts one sync Express execution with the whole batch', () => {
    synth('L5').hasResourceProperties('AWS::Lambda::Function', { Handler: 'dispatcher.start_sync_batch.handler' });
  });

  it('may start a sync Express execution in sync scenarios', () => {
    assert.ok(dispatcherActions(synth('L5')).includes('states:StartSyncExecution'));
  });

  it('reads the queue in batches of 10 within 5 seconds and reports failed items', () => {
    synth('L1').hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 10,
      MaximumBatchingWindowInSeconds: 5,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('may start its workflow and read its queue', () => {
    const actions = dispatcherActions(synth('L2'));
    assert.ok(actions.includes('states:StartExecution'));
    assert.ok(actions.includes('sqs:ReceiveMessage'));
    assert.ok(actions.includes('sqs:DeleteMessage'));
  });

  it('refuses a scenario without a dispatcher', () => {
    assert.throws(() => synth('P1'), /No dispatcher for scenario P1/);
  });

  it('keeps its logs one week and deletes them with the stack', () => {
    synth('L3').hasResource('AWS::Logs::LogGroup', {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: 'Delete',
    });
  });
});
