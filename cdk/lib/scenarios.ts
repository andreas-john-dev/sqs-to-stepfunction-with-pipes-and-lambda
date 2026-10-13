import { Duration } from 'aws-cdk-lib/core';

export type Integration = 'pipe' | 'lambda';
export type WorkflowKind = 'standard-single' | 'standard-batch' | 'express-single' | 'express-batch';
export type Invocation = 'async' | 'sync';

export interface ScenarioConfig {
  /** P1–P4 use EventBridge Pipes, L1–L5 a dispatcher Lambda. */
  readonly id: string;
  readonly integration: Integration;
  readonly workflow: WorkflowKind;
  /** async: start the execution and move on. sync: wait for the result. */
  readonly invocation: Invocation;
  /** Max records per poll from SQS. */
  readonly batchSize: number;
  /** How long SQS may wait to fill a batch. */
  readonly maxBatchingWindow: Duration;
  /** Must cover the time a message is in flight, or SQS hands it out again. */
  readonly visibilityTimeout: Duration;
}

/** Timeout of the dispatcher Lambdas. L3 runs up to 10 executions one after the other. */
export const DISPATCHER_TIMEOUT = Duration.minutes(1);

const SINGLE = { batchSize: 1, maxBatchingWindow: Duration.seconds(0) };
const BATCH = { batchSize: 10, maxBatchingWindow: Duration.seconds(5) };

// Lambda: AWS recommends 6 x the function timeout, plus the batching window.
// All dispatchers use BATCH.
const LAMBDA_VISIBILITY = Duration.seconds(DISPATCHER_TIMEOUT.toSeconds() * 6 + BATCH.maxBatchingWindow.toSeconds());
// Pipe async: the pipe only starts the execution.
const PIPE_ASYNC_VISIBILITY = Duration.minutes(1);
// Pipe sync: the pipe waits for the Express execution, which runs at most 5 minutes.
// With a batching window (P4), the pipe ignores this and sets its own visibility
// timeout: 7 minutes + window + 30 seconds.
const PIPE_SYNC_VISIBILITY = Duration.minutes(6);

export const SCENARIOS: readonly ScenarioConfig[] = [
  { id: 'P1', integration: 'pipe', workflow: 'standard-single', invocation: 'async', ...SINGLE, visibilityTimeout: PIPE_ASYNC_VISIBILITY },
  { id: 'P2', integration: 'pipe', workflow: 'standard-batch', invocation: 'async', ...BATCH, visibilityTimeout: PIPE_ASYNC_VISIBILITY },
  { id: 'P3', integration: 'pipe', workflow: 'express-single', invocation: 'sync', ...SINGLE, visibilityTimeout: PIPE_SYNC_VISIBILITY },
  { id: 'P4', integration: 'pipe', workflow: 'express-batch', invocation: 'sync', ...BATCH, visibilityTimeout: PIPE_SYNC_VISIBILITY },
  // The dispatcher Lambdas always get a batch. L1, L3 and L4 start one execution per record.
  { id: 'L1', integration: 'lambda', workflow: 'standard-single', invocation: 'async', ...BATCH, visibilityTimeout: LAMBDA_VISIBILITY },
  { id: 'L2', integration: 'lambda', workflow: 'standard-batch', invocation: 'async', ...BATCH, visibilityTimeout: LAMBDA_VISIBILITY },
  { id: 'L3', integration: 'lambda', workflow: 'express-single', invocation: 'sync', ...BATCH, visibilityTimeout: LAMBDA_VISIBILITY },
  { id: 'L4', integration: 'lambda', workflow: 'express-single', invocation: 'sync', ...BATCH, visibilityTimeout: LAMBDA_VISIBILITY },
  { id: 'L5', integration: 'lambda', workflow: 'express-batch', invocation: 'sync', ...BATCH, visibilityTimeout: LAMBDA_VISIBILITY },
];

/**
 * The scenarios to deploy. `filter` is the context flag, e.g. `cdk deploy -c scenarios=P3,L4`.
 * Without a filter, all scenarios are deployed.
 */
export function selectScenarios(filter: string | undefined): ScenarioConfig[] {
  if (!filter) return [...SCENARIOS];

  return filter.split(',').map(raw => {
    const id = raw.trim();
    const scenario = SCENARIOS.find(s => s.id === id);
    if (!scenario) {
      throw new Error(`Unknown scenario ${id}. Valid: ${SCENARIOS.map(s => s.id).join(', ')}`);
    }
    return scenario;
  });
}
