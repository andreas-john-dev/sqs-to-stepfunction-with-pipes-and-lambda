import { Duration } from 'aws-cdk-lib/core';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ScenarioConfig } from '../scenarios';

export interface ScenarioQueuesProps {
  readonly scenario: ScenarioConfig;
}

/**
 * The queues of one scenario:
 * - source queue that the pipe or the dispatcher Lambda reads from
 * - SQS DLQ for messages that fail 3 times
 * - workflow error queue, only for async scenarios: the target of the workflow's Catch
 */
export class ScenarioQueues extends Construct {
  public readonly source: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly errorQueue?: sqs.Queue;

  constructor(scope: Construct, id: string, props: ScenarioQueuesProps) {
    super(scope, id);
    const { scenario } = props;

    this.dlq = new sqs.Queue(this, 'Dlq', {
      retentionPeriod: Duration.days(14),
    });

    this.source = new sqs.Queue(this, 'Source', {
      visibilityTimeout: scenario.visibilityTimeout,
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 3 },
    });

    if (scenario.invocation === 'async') {
      this.errorQueue = new sqs.Queue(this, 'WorkflowErrors', {
        retentionPeriod: Duration.days(14),
      });
    }
  }
}
