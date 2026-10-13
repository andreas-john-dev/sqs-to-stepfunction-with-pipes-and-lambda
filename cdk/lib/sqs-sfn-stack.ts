import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

/**
 * The one stack of this repo. It will create all scenarios (P1–P4, L1–L5)
 * side by side, each with its own queues and state machine.
 */
export class SqsSfnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }
}
