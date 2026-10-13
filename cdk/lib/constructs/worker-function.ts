import * as path from 'node:path';
import { Duration } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';

/** Folder with the Python code and the shared requirements.txt. */
export const PYTHON_SRC = path.join(__dirname, '..', '..', '..', 'src');

/** Default sleep of the `slow` test, if the message has no `sleepSeconds`. */
const DEFAULT_SLEEP_SECONDS = 10;

/**
 * The worker Lambda that all workflows call. It processes one SQS record.
 */
export class WorkerFunction extends Construct {
  public readonly function: PythonFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.function = new PythonFunction(this, 'Function', {
      entry: PYTHON_SRC,
      index: 'worker/process_message.py',
      handler: 'handler',
      runtime: lambda.Runtime.PYTHON_3_14,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(1),
      environment: {
        DEFAULT_SLEEP_SECONDS: String(DEFAULT_SLEEP_SECONDS),
      },
      bundling: { assetExcludes: ['__pycache__', '*.pyc'] },
    });
  }
}
