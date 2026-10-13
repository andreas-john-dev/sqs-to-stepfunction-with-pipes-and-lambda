import { RemovalPolicy } from 'aws-cdk-lib/core';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as pipes from '@aws-cdk/aws-pipes-alpha';
import { SqsSource } from '@aws-cdk/aws-pipes-sources-alpha';
import { SfnStateMachine, StateMachineInvocationType } from '@aws-cdk/aws-pipes-targets-alpha';
import { Construct } from 'constructs';
import { ScenarioConfig } from '../scenarios';

export interface PipeIntegrationProps {
  readonly scenario: ScenarioConfig;
  readonly source: sqs.IQueue;
  readonly stateMachine: sfn.IStateMachine;
}

/**
 * EventBridge Pipe from the source queue to the workflow (P1–P4).
 * - async: the pipe starts the execution and deletes the messages.
 * - sync: the pipe waits for the Express execution. Messages that fail
 *   come back from SQS; with batchItemFailures only those messages.
 * The pipe creates its own role with the rights to read the queue and
 * start the state machine.
 */
export class PipeIntegration extends Construct {
  readonly pipe: pipes.Pipe;

  constructor(scope: Construct, id: string, props: PipeIntegrationProps) {
    super(scope, id);
    const { scenario } = props;

    // Failed target calls show up here, e.g. a sync execution that failed.
    const path = this.node.scopes.map(s => s.node.id).filter(Boolean).join('-');
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/aws/vendedlogs/pipes/${path}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.pipe = new pipes.Pipe(this, 'Pipe', {
      source: new SqsSource(props.source, {
        batchSize: scenario.batchSize,
        maximumBatchingWindow: scenario.maxBatchingWindow,
      }),
      target: new SfnStateMachine(props.stateMachine, {
        invocationType:
          scenario.invocation === 'sync'
            ? StateMachineInvocationType.REQUEST_RESPONSE
            : StateMachineInvocationType.FIRE_AND_FORGET,
      }),
      logDestinations: [new pipes.CloudwatchLogsLogDestination(logGroup)],
      logLevel: pipes.LogLevel.ERROR,
    });
  }
}
