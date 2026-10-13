import { Duration } from 'aws-cdk-lib/core';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';
import { pythonFunction } from './python-function';

/** Default sleep of the `slow` test, if the message has no `sleepSeconds`. */
const DEFAULT_SLEEP_SECONDS = 10;

/**
 * The worker Lambda that all workflows call. It processes one SQS record.
 */
export class WorkerFunction extends Construct {
  public readonly function: PythonFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = pythonFunction(this, 'Function', {
      index: 'worker/process_message.py',
      // As long as an Express execution may run, so `slow` can probe how long a pipe waits.
      timeout: Duration.minutes(5),
      environment: {
        DEFAULT_SLEEP_SECONDS: String(DEFAULT_SLEEP_SECONDS),
      },
    });
  }
}
