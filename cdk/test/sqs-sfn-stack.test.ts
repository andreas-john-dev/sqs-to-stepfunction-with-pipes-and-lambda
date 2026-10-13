import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SqsSfnStack } from '../lib/sqs-sfn-stack';
import { testApp } from './helpers';

function synth(context: Record<string, string> = {}): Template {
  return Template.fromStack(new SqsSfnStack(testApp(context), 'Test'));
}

function stateMachineTypes(template: Template): string[] {
  return Object.values(template.findResources('AWS::StepFunctions::StateMachine'))
    .map(r => r.Properties.StateMachineType)
    .sort();
}

describe('SqsSfnStack', () => {
  it('creates a workflow per scenario: 4 Standard, 5 Express', () => {
    const types = stateMachineTypes(synth());

    assert.deepEqual(types, [...Array(5).fill('EXPRESS'), ...Array(4).fill('STANDARD')]);
  });

  it('creates a source queue with DLQ per scenario', () => {
    const sources = synth().findResources('AWS::SQS::Queue', { Properties: { RedrivePolicy: Match.anyValue() } });

    assert.equal(Object.keys(sources).length, 9);
  });

  it('shares one worker Lambda between all workflows', () => {
    synth().resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('deploys only the scenarios from the context flag', () => {
    const types = stateMachineTypes(synth({ scenarios: 'P1,L4' }));

    assert.deepEqual(types, ['EXPRESS', 'STANDARD']);
  });

  it('connects each pipe scenario to its workflow with a pipe', () => {
    synth().resourceCountIs('AWS::Pipes::Pipe', 4);
  });

  it('creates no pipe for the dispatcher scenarios', () => {
    synth({ scenarios: 'L1,L2' }).resourceCountIs('AWS::Pipes::Pipe', 0);
  });

  it('outputs what the test scripts need per scenario', () => {
    const outputs = Object.keys(synth({ scenarios: 'P1,P3' }).findOutputs('*')).sort();

    assert.deepEqual(outputs, [
      'P1DlqUrl', 'P1ErrorQueueUrl', 'P1PipeName', 'P1SourceQueueUrl', 'P1StateMachineArn',
      'P3DlqUrl', 'P3PipeName', 'P3SourceQueueUrl', 'P3StateMachineArn',
    ]);
  });
});
