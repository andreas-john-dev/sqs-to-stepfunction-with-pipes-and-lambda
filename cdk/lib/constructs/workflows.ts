import { Duration, RemovalPolicy } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface WorkflowProps {
  /** The worker Lambda that processes one SQS record. */
  readonly worker: lambda.IFunction;
}

export interface StandardWorkflowProps extends WorkflowProps {
  /** Gets the record and the error when processing fails for good. */
  readonly errorQueue: sqs.IQueue;
}

/**
 * Input of the single workflows: one SQS record. A pipe may send an array
 * with one record even for batch size 1, so both shapes are accepted.
 */
const SINGLE_RECORD_EXPR = "$type($states.input) = 'array' ? $states.input[0] : $states.input";
const SINGLE_RECORD = `{% ${SINGLE_RECORD_EXPR} %}`;

/**
 * express-single (P3, L3, L4): one record, started synchronously.
 * No Retry and no Catch: a failure fails the execution, so the caller
 * sees it and SQS delivers the message again.
 */
export function expressSingleWorkflow(scope: Construct, id: string, props: WorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, `${id}ProcessMessage`, props.worker, SINGLE_RECORD);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.EXPRESS,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processMessage),
    logs: expressLogs(scope, id),
  });
}

/**
 * standard-single (P1, L1): one record, started asynchronously. SQS has
 * already deleted the message, so the workflow handles errors itself:
 * retry TransientError, send everything else to the error queue.
 */
export function standardSingleWorkflow(scope: Construct, id: string, props: StandardWorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, `${id}ProcessMessage`, props.worker, SINGLE_RECORD);
  handleErrors(scope, id, processMessage, props.errorQueue, SINGLE_RECORD_EXPR);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.STANDARD,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processMessage),
  });
}

/**
 * standard-batch (P2, L2): a batch of records, started asynchronously.
 * Each record gets the same retry and catch as in standard-single;
 * a failed record does not stop the others.
 */
export function standardBatchWorkflow(scope: Construct, id: string, props: StandardWorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, `${id}ProcessMessage`, props.worker, '{% $states.input %}');
  handleErrors(scope, id, processMessage, props.errorQueue, '$states.input');

  const processRecords = sfn.Map.jsonata(scope, `${id}ProcessRecords`, {
    stateName: 'ProcessRecords',
    maxConcurrency: MAP_CONCURRENCY,
  }).itemProcessor(processMessage);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.STANDARD,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processRecords),
  });
}

/**
 * Error handling of the standard workflows: retry TransientError, send
 * everything else with the record to the error queue.
 */
function handleErrors(
  scope: Construct,
  id: string,
  processMessage: tasks.LambdaInvoke,
  errorQueue: sqs.IQueue,
  recordExpr: string,
): void {
  processMessage
    .addRetry(TRANSIENT_RETRY)
    .addCatch(sendToQueue(scope, `${id}SendToErrorQueue`, errorQueue), {
      errors: [sfn.Errors.ALL],
      outputs: `{% {"record": ${recordExpr}, "error": $states.errorOutput} %}`,
    });
}

/**
 * express-batch (P4, L5): a batch of records, started synchronously.
 * Each record runs on its own; a failed record does not stop the others.
 * The output tells SQS which messages failed, so only those come back.
 */
export function expressBatchWorkflow(scope: Construct, id: string, props: WorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, `${id}ProcessMessage`, props.worker, '{% $states.input %}');
  const markFailed = sfn.Pass.jsonata(scope, `${id}MarkFailed`, { stateName: 'MarkFailed' });
  processMessage.addCatch(markFailed, {
    errors: [sfn.Errors.ALL],
    outputs: '{% {"messageId": $states.input.messageId, "failed": true} %}',
  });

  const processRecords = sfn.Map.jsonata(scope, `${id}ProcessRecords`, {
    stateName: 'ProcessRecords',
    maxConcurrency: MAP_CONCURRENCY,
  }).itemProcessor(processMessage);

  // Partial batch response: https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html
  const buildBatchResponse = sfn.Pass.jsonata(scope, `${id}BuildBatchResponse`, {
    stateName: 'BuildBatchResponse',
    outputs: '{% {"batchItemFailures": [$states.input[failed = true].{"itemIdentifier": messageId}]} %}',
  });

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.EXPRESS,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processRecords.next(buildBatchResponse)),
    logs: expressLogs(scope, id),
  });
}

/** Same as the max batch size, so a full batch runs at once. */
const MAP_CONCURRENCY = 10;

/** 3 attempts in total: the first call and 2 retries. The worker's `transient` succeeds on attempt 3. */
const TRANSIENT_RETRY: sfn.RetryProps = {
  errors: ['TransientError'],
  interval: Duration.seconds(2),
  maxAttempts: 2,
  backoffRate: 2,
};

/** Sends the state input as JSON text to a queue. */
function sendToQueue(scope: Construct, id: string, queue: sqs.IQueue): tasks.SqsSendMessage {
  return tasks.SqsSendMessage.jsonata(scope, id, {
    stateName: 'SendToErrorQueue',
    queue,
    messageBody: sfn.TaskInput.fromText('{% $string($states.input) %}'),
  });
}

/** Calls the worker with one record and the retry count, returns the worker's result. */
function invokeWorker(scope: Construct, id: string, worker: lambda.IFunction, record: string): tasks.LambdaInvoke {
  return tasks.LambdaInvoke.jsonata(scope, id, {
    stateName: 'ProcessMessage',
    lambdaFunction: worker,
    payload: sfn.TaskInput.fromObject({
      record,
      retryCount: '{% $states.context.State.RetryCount %}',
    }),
    // The workflows decide about retries themselves, not the Lambda task.
    retryOnServiceExceptions: false,
    outputs: '{% $states.result.Payload %}',
  });
}

/** Express executions keep no history, so they log everything. */
function expressLogs(scope: Construct, id: string): sfn.LogOptions {
  return {
    destination: new logs.LogGroup(scope, `${id}Logs`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
    level: sfn.LogLevel.ALL,
    includeExecutionData: true,
  };
}
