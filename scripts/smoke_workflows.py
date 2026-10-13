"""Smoke test for the four workflow types.

Starts the state machines of P1-P4 directly, without pipe or dispatcher,
and prints the result of each run. Reads the queue URLs and state machine
ARNs from the outputs of the deployed stack. Afterwards it reads and deletes
the messages in the error queues of P1 and P2.

Usage (repo root, venv active): python scripts/smoke_workflows.py
"""

import json
import time

import boto3

STACK_NAME = "SqsToStepFunctions"

cloudformation = boto3.client("cloudformation")
sfn = boto3.client("stepfunctions")
sqs = boto3.client("sqs")


def stack_outputs() -> dict:
    stack = cloudformation.describe_stacks(StackName=STACK_NAME)["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}


def record(message_id: str, simulate: str) -> dict:
    """An SQS record as a pipe or the Lambda event source mapping sends it."""
    return {
        "messageId": message_id,
        "body": json.dumps({"simulate": simulate}),
        "attributes": {"ApproximateReceiveCount": "1"},
    }


def result(response: dict) -> dict:
    return {key: response.get(key) for key in ("status", "output", "error", "cause")}


def start_sync(arn: str, payload) -> dict:
    """Express workflow: wait for the result."""
    return result(sfn.start_sync_execution(stateMachineArn=arn, input=json.dumps(payload)))


def start_and_wait(arn: str, payload) -> dict:
    """Standard workflow: start it, then poll until it is done."""
    execution_arn = sfn.start_execution(stateMachineArn=arn, input=json.dumps(payload))["executionArn"]
    while True:
        response = sfn.describe_execution(executionArn=execution_arn)
        if response["status"] != "RUNNING":
            return result(response)
        time.sleep(2)


def take_error_messages(queue_url: str) -> list:
    """Read and delete all messages in a workflow error queue."""
    messages = []
    while True:
        batch = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=10, WaitTimeSeconds=2).get("Messages", [])
        if not batch:
            return messages
        for message in batch:
            body = json.loads(message["Body"])
            messages.append({"messageId": body["record"]["messageId"], "error": body["error"].get("Error")})
            sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"])


def main() -> None:
    out = stack_outputs()
    mixed_batch = [record("ok-1", "ok"), record("fail-1", "fail"), record("transient-1", "transient")]

    cases = [
        ("P3 express-single, ok", lambda: start_sync(out["P3StateMachineArn"], record("ok-1", "ok"))),
        ("P3 express-single, 2 records", lambda: start_sync(out["P3StateMachineArn"], [record("ok-1", "ok"), record("ok-2", "ok")])),
        ("P1 standard-single, transient", lambda: start_and_wait(out["P1StateMachineArn"], record("transient-1", "transient"))),
        ("P1 standard-single, fail", lambda: start_and_wait(out["P1StateMachineArn"], record("fail-1", "fail"))),
        ("P1 error queue", lambda: take_error_messages(out["P1ErrorQueueUrl"])),
        ("P4 express-batch, mixed batch", lambda: start_sync(out["P4StateMachineArn"], mixed_batch)),
        ("P2 standard-batch, mixed batch", lambda: start_and_wait(out["P2StateMachineArn"], mixed_batch)),
        ("P2 error queue", lambda: take_error_messages(out["P2ErrorQueueUrl"])),
    ]
    for name, run in cases:
        print(f"== {name}")
        print(json.dumps(run(), indent=2))


if __name__ == "__main__":
    main()
