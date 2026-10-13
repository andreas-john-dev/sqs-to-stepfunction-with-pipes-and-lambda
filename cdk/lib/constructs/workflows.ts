import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib/core';
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

// The JSONata expressions below are plain expressions. Only the helpers
// that write them into a state field wrap them in {% ... %}.

/**
 * Input of the single workflows: one SQS record. A pipe may send an array
 * with one record even for batch size 1, so both shapes are accepted.
 * More than one record is an error: taking only the first would drop the
 * others, and SQS would still delete them.
 */
const SINGLE_RECORD = `$count($states.input) > 1
  ? $error("Expected one record, got " & $count($states.input))
  : ($type($states.input) = "array" ? $states.input[0] : $states.input)`;

/** Input of a Map item: the record itself. */
const MAP_ITEM = '$states.input';

/**
 * express-single (P3, L3, L4): one record, started synchronously.
 * No Retry and no Catch: a failure fails the execution, so the caller
 * sees it and SQS delivers the message again.
 */
export function expressSingleWorkflow(scope: Construct, id: string, props: WorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, id, props.worker, SINGLE_RECORD);

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
  const processMessage = invokeWorker(scope, id, props.worker, SINGLE_RECORD);
  handleErrors(scope, id, processMessage, props.errorQueue, SINGLE_RECORD);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.STANDARD,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processMessage),
  });
}

/**
 * express-batch (P4, L5): a batch of records, started synchronously.
 * Each record runs on its own; a failed record does not stop the others.
 * The output tells SQS which messages failed, so only those come back.
 */
export function expressBatchWorkflow(scope: Construct, id: string, props: WorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, id, props.worker, MAP_ITEM);
  const markFailed = sfn.Pass.jsonata(scope, `${id}MarkFailed`, { stateName: 'MarkFailed' });
  processMessage.addCatch(markFailed, {
    errors: [sfn.Errors.ALL],
    outputs: '{% {"messageId": $states.input.messageId, "failed": true} %}',
  });

  // Partial batch response: https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html
  const buildBatchResponse = sfn.Pass.jsonata(scope, `${id}BuildBatchResponse`, {
    stateName: 'BuildBatchResponse',
    outputs: '{% {"batchItemFailures": [$states.input[failed = true].{"itemIdentifier": messageId}]} %}',
  });

  const definition = processEachRecord(scope, id, processMessage).next(buildBatchResponse);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.EXPRESS,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(definition),
    logs: expressLogs(scope, id),
  });
}

/**
 * standard-batch (P2, L2): a batch of records, started asynchronously.
 * Each record gets the same retry and catch as in standard-single;
 * a failed record does not stop the others.
 */
export function standardBatchWorkflow(scope: Construct, id: string, props: StandardWorkflowProps): sfn.StateMachine {
  const processMessage = invokeWorker(scope, id, props.worker, MAP_ITEM);
  handleErrors(scope, id, processMessage, props.errorQueue, MAP_ITEM);

  return new sfn.StateMachine(scope, id, {
    stateMachineType: sfn.StateMachineType.STANDARD,
    queryLanguage: sfn.QueryLanguage.JSONATA,
    definitionBody: sfn.DefinitionBody.fromChainable(processEachRecord(scope, id, processMessage)),
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

/** Calls the worker with one record and the retry count, returns the worker's result. */
function invokeWorker(scope: Construct, id: string, worker: lambda.IFunction, record: string): tasks.LambdaInvoke {
  return tasks.LambdaInvoke.jsonata(scope, `${id}ProcessMessage`, {
    stateName: 'ProcessMessage',
    lambdaFunction: worker,
    payload: sfn.TaskInput.fromObject({
      record: `{% ${record} %}`,
      retryCount: '{% $states.context.State.RetryCount %}',
    }),
    // The workflows decide about retries themselves, not the Lambda task.
    retryOnServiceExceptions: false,
    outputs: '{% $states.result.Payload %}',
  });
}

/** Inline Map that runs `processMessage` for each record of the input array. */
function processEachRecord(scope: Construct, id: string, processMessage: sfn.IChainable): sfn.Map {
  return sfn.Map.jsonata(scope, `${id}ProcessRecords`, {
    stateName: 'ProcessRecords',
    maxConcurrency: MAP_CONCURRENCY,
  }).itemProcessor(processMessage);
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
  record: string,
): void {
  const sendToErrorQueue = tasks.SqsSendMessage.jsonata(scope, `${id}SendToErrorQueue`, {
    stateName: 'SendToErrorQueue',
    queue: errorQueue,
    messageBody: sfn.TaskInput.fromText('{% $string($states.input) %}'),
  });

  processMessage
    .addRetry(TRANSIENT_RETRY)
    .addCatch(sendToErrorQueue, {
      errors: [sfn.Errors.ALL],
      outputs: `{% {"record": ${record}, "error": $states.errorOutput} %}`,
    });
}

/**
 * Express executions keep no history, so they log everything. The
 * /aws/vendedlogs/ prefix keeps the log groups out of the CloudWatch Logs
 * resource policy, which has a size limit and fills up with many workflows.
 */
function expressLogs(scope: Construct, id: string): sfn.LogOptions {
  return {
    destination: new logs.LogGroup(scope, `${id}Logs`, {
      logGroupName: `/aws/vendedlogs/states/${Stack.of(scope).stackName}-${id}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
    level: sfn.LogLevel.ALL,
    includeExecutionData: true,
  };
}
