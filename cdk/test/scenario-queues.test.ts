import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ScenarioQueues } from '../lib/constructs/scenario-queues';
import { SCENARIOS, ScenarioConfig } from '../lib/scenarios';

function synth(scenario: ScenarioConfig): Template {
  const stack = new cdk.Stack();
  new ScenarioQueues(stack, 'Queues', { scenario });
  return Template.fromStack(stack);
}

function scenario(id: string): ScenarioConfig {
  const found = SCENARIOS.find(s => s.id === id);
  assert.ok(found, `scenario ${id} missing`);
  return found;
}

describe('SCENARIOS', () => {
  it('lists the 9 scenarios from the plan', () => {
    assert.deepEqual(
      SCENARIOS.map(s => s.id),
      ['P1', 'P2', 'P3', 'P4', 'L1', 'L2', 'L3', 'L4', 'L5'],
    );
  });

  it('uses async invocation exactly for the standard workflows', () => {
    for (const s of SCENARIOS) {
      assert.equal(s.invocation === 'async', s.workflow.startsWith('standard'), s.id);
    }
  });
});

describe('ScenarioQueues', () => {
  it('sends a message to the DLQ after 3 receives', () => {
    const template = synth(scenario('P3'));

    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: {
        deadLetterTargetArn: Match.anyValue(),
        maxReceiveCount: 3,
      },
    });
  });

  it('sets the visibility timeout from the scenario', () => {
    const p3 = scenario('P3');
    const template = synth(p3);

    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: p3.visibilityTimeout.toSeconds(),
      RedrivePolicy: Match.anyValue(),
    });
  });

  it('denies access without TLS on every queue', () => {
    const template = synth(scenario('P1'));

    template.resourceCountIs('AWS::SQS::QueuePolicy', 3);
    template.allResourcesProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  it('creates a workflow error queue for async scenarios', () => {
    const template = synth(scenario('P1'));

    template.resourceCountIs('AWS::SQS::Queue', 3);
  });

  it('creates no workflow error queue for sync scenarios', () => {
    const stack = new cdk.Stack();
    const queues = new ScenarioQueues(stack, 'Queues', { scenario: scenario('L4') });

    assert.equal(queues.errorQueue, undefined);
    Template.fromStack(stack).resourceCountIs('AWS::SQS::Queue', 2);
  });
});
