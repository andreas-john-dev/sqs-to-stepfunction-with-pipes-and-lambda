import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { DISPATCHERS, DispatcherFunction } from './constructs/dispatcher-function';
import { PipeIntegration } from './constructs/pipe-integration';
import { ScenarioQueues } from './constructs/scenario-queues';
import { WorkerFunction } from './constructs/worker-function';
import {
  expressBatchWorkflow,
  expressSingleWorkflow,
  standardBatchWorkflow,
  standardSingleWorkflow,
} from './constructs/workflows';
import { ScenarioConfig, selectScenarios } from './scenarios';

/**
 * The one stack of this repo. It creates the selected scenarios side by
 * side, each with its own queues and state machine, and one shared worker.
 * P1–P4 start their workflow through a pipe, L1–L5 through a dispatcher
 * Lambda.
 */
export class SqsSfnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const worker = new WorkerFunction(this, 'Worker').function;

    for (const scenario of selectScenarios(this.node.tryGetContext('scenarios'))) {
      const scenarioScope = new Construct(this, scenario.id);
      const queues = new ScenarioQueues(scenarioScope, 'Queues', { scenario });
      const workflow = createWorkflow(scenarioScope, scenario, worker, queues);
      if (scenario.integration === 'pipe') {
        const { pipe } = new PipeIntegration(scenarioScope, 'Pipe', {
          scenario,
          source: queues.source,
          stateMachine: workflow,
        });
        new cdk.CfnOutput(this, `${scenario.id}PipeName`, { value: pipe.pipeName });
      }
      // Until all dispatchers exist, only the scenarios that have one are wired.
      if (scenario.integration === 'lambda' && DISPATCHERS[scenario.id]) {
        const dispatcher = new DispatcherFunction(scenarioScope, 'Dispatcher', {
          scenario,
          source: queues.source,
          stateMachine: workflow,
        });
        new cdk.CfnOutput(this, `${scenario.id}DispatcherName`, { value: dispatcher.function.functionName });
      }

      new cdk.CfnOutput(this, `${scenario.id}SourceQueueUrl`, { value: queues.source.queueUrl });
      new cdk.CfnOutput(this, `${scenario.id}DlqUrl`, { value: queues.dlq.queueUrl });
      if (queues.errorQueue) {
        new cdk.CfnOutput(this, `${scenario.id}ErrorQueueUrl`, { value: queues.errorQueue.queueUrl });
      }
      new cdk.CfnOutput(this, `${scenario.id}StateMachineArn`, { value: workflow.stateMachineArn });
    }
  }
}

function createWorkflow(
  scope: Construct,
  scenario: ScenarioConfig,
  worker: lambda.IFunction,
  queues: ScenarioQueues,
): sfn.StateMachine {
  switch (scenario.workflow) {
    case 'express-single':
      return expressSingleWorkflow(scope, 'Workflow', { worker });
    case 'express-batch':
      return expressBatchWorkflow(scope, 'Workflow', { worker });
    case 'standard-single':
      return standardSingleWorkflow(scope, 'Workflow', { worker, errorQueue: errorQueueOf(scenario, queues) });
    case 'standard-batch':
      return standardBatchWorkflow(scope, 'Workflow', { worker, errorQueue: errorQueueOf(scenario, queues) });
  }
}

function errorQueueOf(scenario: ScenarioConfig, queues: ScenarioQueues): sqs.IQueue {
  if (!queues.errorQueue) throw new Error(`Scenario ${scenario.id} has a standard workflow but no error queue`);
  return queues.errorQueue;
}
