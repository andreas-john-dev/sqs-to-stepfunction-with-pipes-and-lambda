import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PipeIntegration } from '../lib/constructs/pipe-integration';
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
  new PipeIntegration(scope, 'Pipe', { scenario, source, stateMachine });
  return Template.fromStack(stack);
}

/** All actions the pipe role may call. Policies of other roles, like the workflow's, do not count. */
function pipeRoleActions(template: Template): string[] {
  const pipe = Object.values(template.findResources('AWS::Pipes::Pipe'))[0];
  const pipeRoleId = pipe.Properties.RoleArn['Fn::GetAtt'][0];
  const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter(policy =>
    policy.Properties.Roles.some((role: { Ref: string }) => role.Ref === pipeRoleId),
  );
  assert.ok(policies.length > 0, 'pipe role has no policy');
  return policies.flatMap(policy =>
    policy.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) => [s.Action].flat()),
  );
}

describe('PipeIntegration', () => {
  it('reads one record at a time for a single scenario', () => {
    synth('P1').hasResourceProperties('AWS::Pipes::Pipe', {
      SourceParameters: { SqsQueueParameters: { BatchSize: 1, MaximumBatchingWindowInSeconds: 0 } },
    });
  });

  it('reads up to 10 records within 5 seconds for a batch scenario', () => {
    synth('P4').hasResourceProperties('AWS::Pipes::Pipe', {
      SourceParameters: { SqsQueueParameters: { BatchSize: 10, MaximumBatchingWindowInSeconds: 5 } },
    });
  });

  it('starts async scenarios fire and forget', () => {
    synth('P2').hasResourceProperties('AWS::Pipes::Pipe', {
      TargetParameters: { StepFunctionStateMachineParameters: { InvocationType: 'FIRE_AND_FORGET' } },
    });
  });

  it('waits for the result in sync scenarios', () => {
    synth('P3').hasResourceProperties('AWS::Pipes::Pipe', {
      TargetParameters: { StepFunctionStateMachineParameters: { InvocationType: 'REQUEST_RESPONSE' } },
    });
  });

  it('may start a standard execution and read the queue in async scenarios', () => {
    const actions = pipeRoleActions(synth('P1'));
    assert.ok(actions.includes('states:StartExecution'));
    assert.ok(actions.includes('sqs:ReceiveMessage'));
    assert.ok(actions.includes('sqs:DeleteMessage'));
  });

  it('may start a sync express execution in sync scenarios', () => {
    assert.ok(pipeRoleActions(synth('P3')).includes('states:StartSyncExecution'));
  });

  it('logs errors to a vended log group named after the construct path', () => {
    const template = synth('P3');
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/vendedlogs/pipes/Test-P3-Pipe',
      RetentionInDays: 7,
    });
    template.hasResourceProperties('AWS::Pipes::Pipe', {
      LogConfiguration: { Level: 'ERROR', CloudwatchLogsLogDestination: { LogGroupArn: Match.anyValue() } },
    });
  });
});
