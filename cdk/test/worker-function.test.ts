import { describe, it } from 'node:test';
import { Template } from 'aws-cdk-lib/assertions';
import { WorkerFunction } from '../lib/constructs/worker-function';
import { testStack } from './helpers';

function synth(): Template {
  const stack = testStack();
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

  it('may run as long as an Express execution, so the slow test can probe the pipe timeout', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 300,
      Environment: { Variables: { DEFAULT_SLEEP_SECONDS: '10' } },
    });
  });
});
