"""Outputs of the deployed stack, shared by the test scripts."""

import boto3

STACK_NAME = "SqsToStepFunctions"


def stack_outputs() -> dict:
    stack = boto3.client("cloudformation").describe_stacks(StackName=STACK_NAME)["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}


def scenario_outputs(scenario: str) -> dict:
    """The outputs of one scenario without the prefix, e.g. SourceQueueUrl."""
    outputs = {key.removeprefix(scenario): value for key, value in stack_outputs().items() if key.startswith(scenario)}
    if not outputs:
        raise SystemExit(f"Scenario {scenario} is not deployed in stack {STACK_NAME}")
    return outputs
