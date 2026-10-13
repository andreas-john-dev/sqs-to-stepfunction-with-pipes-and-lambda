import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import jsonata from 'jsonata';
import { Construct } from 'constructs';
import { WorkerFunction } from '../lib/constructs/worker-function';
import {
  expressBatchWorkflow,
  expressSingleWorkflow,
  standardBatchWorkflow,
  standardSingleWorkflow,
} from '../lib/constructs/workflows';
import { allStates, definitionOf, onlyStateMachineId, testStack } from './helpers';

/** Evaluates a JSONata field (`{% ... %}`) like Step Functions does, including the JSON round trip. */
async function evaluate(field: unknown, input: unknown): Promise<unknown> {
  const expression = String(field).replace(/^{%/, '').replace(/%}$/, '');
  const result = await jsonata(expression).evaluate({}, { states: { input } });
  return JSON.parse(JSON.stringify(result));
}

const RECORD = { messageId: 'm-1', body: '{}' };

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

  function recordArgument(): unknown {
    const template = synth();
    const state = definitionOf(template, onlyStateMachineId(template)).States.ProcessMessage;
    return (state.Arguments as { Payload: { record: unknown } }).Payload.record;
  }

  it('accepts a single record', async () => {
    assert.deepEqual(await evaluate(recordArgument(), RECORD), RECORD);
  });

  it('accepts an array with one record, as a pipe may send it', async () => {
    assert.deepEqual(await evaluate(recordArgument(), [RECORD]), RECORD);
  });

  it('fails for more than one record instead of dropping the rest', async () => {
    await assert.rejects(evaluate(recordArgument(), [RECORD, { messageId: 'm-2', body: '{}' }]), {
      message: /Expected one record, got 2/,
    });
  });

  it('writes its logs to a vended logs group, to stay clear of the resource policy limit', () => {
    synth().hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: Match.stringLikeRegexp('^/aws/vendedlogs/states/'),
    });
  });
});

describe('express log groups', () => {
  it('get a unique name per workflow, also with the same id in different scopes', () => {
    const stack = testStack();
    const worker = new WorkerFunction(stack, 'Worker').function;
    expressSingleWorkflow(new Construct(stack, 'P3'), 'Workflow', { worker });
    expressSingleWorkflow(new Construct(stack, 'L4'), 'Workflow', { worker });

    const names = Object.values(Template.fromStack(stack).findResources('AWS::Logs::LogGroup'))
      .map(r => r.Properties.LogGroupName)
      .filter(name => typeof name === 'string' && name.startsWith('/aws/vendedlogs/'));

    assert.deepEqual(names.sort(), ['/aws/vendedlogs/states/Test-L4-Workflow', '/aws/vendedlogs/states/Test-P3-Workflow']);
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

  it('ends as FAILED after sending the record to the error queue', () => {
    const all = states();

    assert.equal(all[String(all.SendToErrorQueue.Next)].Type, 'Fail');
  });

  it('may send to the error queue', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'sqs:SendMessage' })]),
      },
    });
  });
});

describe('expressBatchWorkflow', () => {
  function synth(): Template {
    const stack = testStack();
    const worker = new WorkerFunction(stack, 'Worker').function;
    expressBatchWorkflow(stack, 'Workflow', { worker });
    return Template.fromStack(stack);
  }

  function definition() {
    const template = synth();
    return definitionOf(template, onlyStateMachineId(template));
  }

  it('is an Express state machine that logs everything', () => {
    synth().hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'EXPRESS',
      LoggingConfiguration: Match.objectLike({ Level: 'ALL', IncludeExecutionData: true }),
    });
  });

  it('runs at most 10 records at the same time', () => {
    const map = Object.values(definition().States).find(s => s.Type === 'Map');

    assert.equal(map?.MaxConcurrency, 10);
  });

  it('catches every error per record and does not retry', () => {
    const states = allStates(definition());

    assert.equal(states.ProcessMessage.Retry, undefined);
    assert.deepEqual(states.ProcessMessage.Catch?.map(c => c.ErrorEquals), [['States.ALL']]);
  });

  it('returns the failed message IDs as batchItemFailures', async () => {
    const mapResult = [
      { messageId: 'a', status: 'ok', attempt: 1 },
      { messageId: 'b', failed: true },
      { messageId: 'c', failed: true },
    ];

    const output = await evaluate(definition().States.BuildBatchResponse.Output, mapResult);

    assert.deepEqual(output, { batchItemFailures: [{ itemIdentifier: 'b' }, { itemIdentifier: 'c' }] });
  });

  it('returns a list also for exactly one failed record', async () => {
    const mapResult = [{ messageId: 'b', failed: true }];

    const output = await evaluate(definition().States.BuildBatchResponse.Output, mapResult);

    assert.deepEqual(output, { batchItemFailures: [{ itemIdentifier: 'b' }] });
  });

  it('writes its logs to a vended logs group', () => {
    synth().hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: Match.stringLikeRegexp('^/aws/vendedlogs/states/'),
    });
  });

  it('returns an empty batchItemFailures list when all records succeed', async () => {
    const mapResult = [{ messageId: 'a', status: 'ok', attempt: 1 }];

    const output = await evaluate(definition().States.BuildBatchResponse.Output, mapResult);

    assert.deepEqual(output, { batchItemFailures: [] });
  });

  it('marks a failed record with its message ID', async () => {
    const [catcher] = allStates(definition()).ProcessMessage.Catch ?? [];
    const output = await evaluate(catcher.Output, { messageId: 'b', body: '{}' });

    assert.deepEqual(output, { messageId: 'b', failed: true });
  });
});

describe('standardBatchWorkflow', () => {
  function synth(): Template {
    const stack = testStack();
    const worker = new WorkerFunction(stack, 'Worker').function;
    const errorQueue = new sqs.Queue(stack, 'Errors');
    standardBatchWorkflow(stack, 'Workflow', { worker, errorQueue });
    return Template.fromStack(stack);
  }

  function definition() {
    const template = synth();
    return definitionOf(template, onlyStateMachineId(template));
  }

  it('is a Standard state machine', () => {
    synth().hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineType: 'STANDARD' });
  });

  it('runs at most 10 records at the same time', () => {
    const map = Object.values(definition().States).find(s => s.Type === 'Map');

    assert.equal(map?.MaxConcurrency, 10);
  });

  it('retries TransientError per record, like standard-single', () => {
    const states = allStates(definition());

    assert.deepEqual(states.ProcessMessage.Retry, [
      { ErrorEquals: ['TransientError'], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 },
    ]);
  });

  it('sends only the failed record to the error queue', () => {
    const states = allStates(definition());
    const [catcher] = states.ProcessMessage.Catch ?? [];

    assert.deepEqual(catcher.ErrorEquals, ['States.ALL']);
    assert.match(String(states[catcher.Next].Resource), /sqs:sendMessage$/);
    assert.equal(catcher.Output, '{% {"record": $states.input, "error": $states.errorOutput} %}');
  });

  it('may send to the error queue', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'sqs:SendMessage' })]),
      },
    });
  });

  it('marks a record that went to the error queue as failed', async () => {
    const states = allStates(definition());
    const sentToErrorQueue = { record: { messageId: 'b', body: '{}' }, error: { Error: 'PermanentError' } };

    const output = await evaluate(states.SendToErrorQueue.Output, sentToErrorQueue);

    assert.deepEqual(output, { messageId: 'b', failed: true });
  });

  it('keeps the Fail state out of the Map, so the other records still finish', () => {
    const map = Object.values(definition().States).find(s => s.Type === 'Map');
    const itemStates = Object.values(map?.ItemProcessor?.States ?? {});

    assert.ok(itemStates.length > 0);
    assert.ok(itemStates.every(s => s.Type !== 'Fail'));
  });

  describe('after the Map', () => {
    const mapResult = [
      { messageId: 'a', status: 'ok', attempt: 1 },
      { messageId: 'b', failed: true },
    ];

    function check() {
      const states = definition().States;
      const choice = Object.values(states).find(s => s.Type === 'Choice');
      assert.ok(choice);
      const [rule] = choice.Choices as { Condition: string; Next: string }[];
      return { states, choice, rule };
    }

    it('fails the execution when at least one record failed', async () => {
      const { states, rule } = check();

      assert.equal(await evaluate(rule.Condition, mapResult), true);
      assert.equal(states[rule.Next].Type, 'Fail');
    });

    it('succeeds when all records succeeded', async () => {
      const { states, choice, rule } = check();

      assert.equal(await evaluate(rule.Condition, [{ messageId: 'a', status: 'ok', attempt: 1 }]), false);
      assert.equal(states[String(choice.Default)].Type, 'Succeed');
    });

    it('says in the cause how many records failed', async () => {
      const { states, rule } = check();

      assert.equal(await evaluate(states[rule.Next].Cause, mapResult), '1 of 2 records sent to the error queue');
    });
  });
});
