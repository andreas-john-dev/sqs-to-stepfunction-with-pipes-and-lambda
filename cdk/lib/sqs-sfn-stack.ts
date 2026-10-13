import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { WorkerFunction } from './constructs/worker-function';
import { expressSingleWorkflow } from './constructs/workflows';

/**
 * The one stack of this repo. It will create all scenarios (P1–P4, L1–L5)
 * side by side, each with its own queues and state machine.
 */
export class SqsSfnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const worker = new WorkerFunction(this, 'Worker').function;

    // First slice: one workflow to try by hand. Task 8 replaces this with one workflow per scenario.
    const expressSingle = expressSingleWorkflow(this, 'ExpressSingle', { worker });
    new cdk.CfnOutput(this, 'ExpressSingleArn', { value: expressSingle.stateMachineArn });
  }
}
