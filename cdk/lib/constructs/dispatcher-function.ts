import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';
import { DISPATCHER_TIMEOUT, ScenarioConfig } from '../scenarios';
import { pythonFunction } from './python-function';

interface Dispatcher {
  /** Module path below src/. */
  readonly index: string;
  readonly environment?: Record<string, string>;
}

/** Which handler starts the workflow in each Lambda scenario. */
export const DISPATCHERS: Readonly<Record<string, Dispatcher>> = {
  L1: { index: 'dispatcher/start_async.py', environment: { START_MODE: 'per-record' } },
  L2: { index: 'dispatcher/start_async.py', environment: { START_MODE: 'batch' } },
  L3: { index: 'dispatcher/start_sync_sequential.py' },
  L4: { index: 'dispatcher/start_sync_parallel.py' },
  L5: { index: 'dispatcher/start_sync_batch.py' },
};

export interface DispatcherFunctionProps {
  readonly scenario: ScenarioConfig;
  readonly source: sqs.IQueue;
  readonly stateMachine: sfn.IStateMachine;
}

/**
 * Dispatcher Lambda of L1–L5: the event source mapping hands it a batch
 * from the source queue, and it starts the workflow. Its response lists
 * the records that failed, so only those come back to the queue.
 */
export class DispatcherFunction extends Construct {
  readonly function: PythonFunction;

  constructor(scope: Construct, id: string, props: DispatcherFunctionProps) {
    super(scope, id);
    const { scenario, stateMachine } = props;
    const dispatcher = DISPATCHERS[scenario.id];
    if (!dispatcher) throw new Error(`No dispatcher for scenario ${scenario.id}`);

    this.function = pythonFunction(this, 'Function', {
      index: dispatcher.index,
      timeout: DISPATCHER_TIMEOUT,
      environment: { STATE_MACHINE_ARN: stateMachine.stateMachineArn, ...dispatcher.environment },
    });

    this.function.addEventSource(
      new SqsEventSource(props.source, {
        batchSize: scenario.batchSize,
        maxBatchingWindow: scenario.maxBatchingWindow,
        // Without this, Lambda ignores the batchItemFailures in the response.
        reportBatchItemFailures: true,
      }),
    );

    if (scenario.invocation === 'sync') {
      stateMachine.grantStartSyncExecution(this.function);
    } else {
      stateMachine.grantStartExecution(this.function);
    }
  }
}
