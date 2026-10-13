import * as path from 'node:path';
import { Duration } from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';

/** Folder with the Python code and the shared requirements.txt. */
const PYTHON_SRC = path.join(__dirname, '..', '..', '..', 'src');

export interface PythonFunctionProps {
  /** Module path below src/, e.g. 'worker/process_message.py'. */
  readonly index: string;
  readonly timeout: Duration;
  readonly environment: Record<string, string>;
}

/**
 * All Lambdas share one code folder and requirements.txt, and differ only
 * in the handler. Python 3.14 on arm64.
 */
export function pythonFunction(scope: Construct, id: string, props: PythonFunctionProps): PythonFunction {
  return new PythonFunction(scope, id, {
    entry: PYTHON_SRC,
    index: props.index,
    handler: 'handler',
    runtime: lambda.Runtime.PYTHON_3_14,
    architecture: lambda.Architecture.ARM_64,
    timeout: props.timeout,
    environment: props.environment,
    bundling: { assetExcludes: ['__pycache__', '*.pyc'] },
  });
}
