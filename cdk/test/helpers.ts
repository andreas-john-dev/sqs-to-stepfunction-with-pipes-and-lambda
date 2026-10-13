import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';

/** An app that skips Docker bundling, so tests only look at the template. */
export function testApp(context: Record<string, string> = {}): cdk.App {
  return new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
}

export function testStack(): cdk.Stack {
  return new cdk.Stack(testApp(), 'Test');
}

/**
 * The state machine definition as an object. CloudFormation tokens
 * (ARNs and the like) become the string "TOKEN".
 */
export function definitionOf(template: Template, logicalId: string): StateMachineDefinition {
  const props = template.toJSON().Resources[logicalId].Properties;
  const parts: unknown[] = props.DefinitionString['Fn::Join'][1];
  const json = parts.map(part => (typeof part === 'string' ? part : 'TOKEN')).join('');
  return JSON.parse(json);
}

export function onlyStateMachineId(template: Template): string {
  const ids = Object.keys(template.findResources('AWS::StepFunctions::StateMachine'));
  if (ids.length !== 1) throw new Error(`expected 1 state machine, found ${ids.length}`);
  return ids[0];
}

/** All states, including the ones inside Map item processors. */
export function allStates(definition: StateMachineDefinition): Record<string, State> {
  const result: Record<string, State> = {};
  for (const [name, state] of Object.entries(definition.States)) {
    result[name] = state;
    if (state.ItemProcessor) Object.assign(result, allStates(state.ItemProcessor));
  }
  return result;
}

export interface StateMachineDefinition {
  QueryLanguage?: string;
  StartAt: string;
  States: Record<string, State>;
}

export interface State {
  Type: string;
  Retry?: { ErrorEquals: string[]; MaxAttempts?: number }[];
  Catch?: { ErrorEquals: string[]; Next: string; Output?: string }[];
  ItemProcessor?: StateMachineDefinition;
  MaxConcurrency?: number;
  Output?: unknown;
  [key: string]: unknown;
}
