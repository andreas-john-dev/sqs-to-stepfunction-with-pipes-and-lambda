"""Dispatcher for L1 and L2: start a Standard workflow and return at once.

START_MODE decides how:
- `per-record` (L1): one execution per record, named after the messageId.
  If SQS delivers a message twice, the second start fails with
  ExecutionAlreadyExists, so the record is not processed twice.
- `batch` (L2): one execution with all records; the workflow maps over them.

After the start, SQS deletes the message. From then on the workflow
handles all errors itself.
"""

import functools
import json
import os
import time

import boto3
from botocore.exceptions import ClientError

from common.batch_response import batch_response, log_batch


@functools.cache
def sfn_client():
    return boto3.client("stepfunctions")


def handler(event: dict, context) -> dict:
    started = time.monotonic()
    records = event["Records"]
    arn = os.environ["STATE_MACHINE_ARN"]

    match os.environ.get("START_MODE"):
        case "per-record":
            failed = dispatch_per_record(records, sfn_client(), arn)
        case "batch":
            failed = dispatch_batch(records, sfn_client(), arn)
        case mode:
            raise ValueError(f"Unknown START_MODE {mode}, expected per-record or batch")

    log_batch(len(records), len(failed), started, time.monotonic())
    return batch_response(failed)


def dispatch_per_record(records: list, sfn, arn: str) -> list:
    """Start one execution per record. Returns the messageIds whose start failed."""
    failed = []
    for record in records:
        try:
            sfn.start_execution(stateMachineArn=arn, name=record["messageId"], input=json.dumps(record))
        except ClientError as error:
            if error.response["Error"]["Code"] != "ExecutionAlreadyExists":
                print(f"Start failed for {record['messageId']}: {error}")
                failed.append(record["messageId"])
    return failed


def dispatch_batch(records: list, sfn, arn: str) -> list:
    """Start one execution with all records. An error goes up, so the whole batch comes back."""
    sfn.start_execution(stateMachineArn=arn, input=json.dumps(records))
    return []
