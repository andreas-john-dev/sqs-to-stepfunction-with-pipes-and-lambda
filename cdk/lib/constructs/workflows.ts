import { RemovalPolicy } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface WorkflowProps {
  /** The worker Lambda that processes one SQS record. */
  readonly worker: lambda.IFunction;
}

/**
 * Input of the single workflows: one SQS record. A pipe may send an array
 * with one record even for batch size 1, so both shapes are accepted.
 */
const SINGLE_RECORD = "{% $type($states.input) = 'array' ? $states.input[0] : $states.input %}";

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
