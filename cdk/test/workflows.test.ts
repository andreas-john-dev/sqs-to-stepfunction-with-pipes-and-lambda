import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { WorkerFunction } from '../lib/constructs/worker-function';
import { expressSingleWorkflow, standardSingleWorkflow } from '../lib/constructs/workflows';
import { allStates, definitionOf, onlyStateMachineId, testStack } from './helpers';

describe('expressSingleWorkflow', () => {
  function synth(): Template {
    const stack = testStack();
    const worker = new WorkerFunction(stack, 'Worker').function;
    expressSingleWorkflow(stack, 'Workflow', { worker });
    return Template.fromStack(stack);
  }

  it('is an Express state machine that logs everything', () => {
    synth().hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'EXPRESS',
      LoggingConfiguration: Match.objectLike({ Level: 'ALL', IncludeExecutionData: true }),
    });
  });

  it('uses JSONata', () => {
    const template = synth();

    assert.equal(definitionOf(template, onlyStateMachineId(template)).QueryLanguage, 'JSONata');
  });

  it('has no Retry and no Catch, so failures reach SQS', () => {
    const template = synth();
    const states = allStates(definitionOf(template, onlyStateMachineId(template)));

    for (const [name, state] of Object.entries(states)) {
      assert.equal(state.Retry, undefined, `${name} has Retry`);
      assert.equal(state.Catch, undefined, `${name} has Catch`);
    }
  });

  it('passes the record and the retry count to the worker', () => {
    const template = synth();
    const states = allStates(definitionOf(template, onlyStateMachineId(template)));
    const task = Object.values(states).find(s => s.Type === 'Task');

    assert.ok(task);
    assert.deepEqual(Object.keys((task.Arguments as { Payload: object }).Payload).sort(), ['record', 'retryCount']);
  });
});

describe('standardSingleWorkflow', () => {
  function synth(): Template {
    const stack = testStack();
    const worker = new WorkerFunction(stack, 'Worker').function;
    const errorQueue = new sqs.Queue(stack, 'Errors');
    standardSingleWorkflow(stack, 'Workflow', { worker, errorQueue });
    return Template.fromStack(stack);
  }

  function states() {
    const template = synth();
    return definitionOf(template, onlyStateMachineId(template)).States;
  }

  it('is a Standard state machine with JSONata', () => {
    const template = synth();

    template.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineType: 'STANDARD' });
    assert.equal(definitionOf(template, onlyStateMachineId(template)).QueryLanguage, 'JSONata');
  });

  it('retries TransientError so the third attempt is the last one', () => {
    const retry = states().ProcessMessage.Retry;

    assert.deepEqual(retry, [{ ErrorEquals: ['TransientError'], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 }]);
  });

  it('catches every other error and sends it to the error queue', () => {
    const all = states();
    const [catcher] = all.ProcessMessage.Catch ?? [];

    assert.deepEqual(catcher.ErrorEquals, ['States.ALL']);
    assert.match(String(all[catcher.Next].Resource), /sqs:sendMessage$/);
  });

  it('may send to the error queue', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'sqs:SendMessage' })]),
      },
    });
  });
});
