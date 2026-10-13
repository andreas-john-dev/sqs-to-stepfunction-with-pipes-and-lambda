import { describe, it } from 'node:test';
import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { WorkerFunction } from '../lib/constructs/worker-function';

function synth(): Template {
  // Skip Docker bundling, the tests only look at the template.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new cdk.Stack(app, 'Test');
  new WorkerFunction(stack, 'Worker');
  return Template.fromStack(stack);
}

describe('WorkerFunction', () => {
  it('runs the Python worker handler on Python 3.14', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.14',
      Handler: 'worker.process_message.handler',
    });
  });

  it('has a timeout long enough for the slow test', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 60,
      Environment: { Variables: { DEFAULT_SLEEP_SECONDS: '10' } },
    });
  });
});
