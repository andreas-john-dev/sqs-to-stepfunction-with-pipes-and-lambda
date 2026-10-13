"""Dispatcher for L3: one sync Express execution per record, one after the other.

This is the baseline for L4. The run times add up: ten records that take
30 seconds each need 300 seconds, longer than the dispatcher may run.
Then the whole batch comes back to the queue.
"""

import json
import os
import time

from botocore.exceptions import ClientError

from common.batch_response import batch_response, log_batch
from dispatcher.sync_result import sfn_client, succeeded


def handler(event: dict, context) -> dict:
    started = time.monotonic()
    records = event["Records"]

    failed = dispatch(records, sfn_client(), os.environ["STATE_MACHINE_ARN"])

    log_batch(len(records), len(failed), started, time.monotonic())
    return batch_response(failed)


def dispatch(records: list, sfn, arn: str) -> list:
    """Returns the messageIds whose execution did not succeed."""
    failed = []
    for record in records:
        message_id = record["messageId"]
        try:
            response = sfn.start_sync_execution(stateMachineArn=arn, input=json.dumps(record))
        except ClientError as error:
            print(f"{message_id}: {error}")
            failed.append(message_id)
            continue
        if not succeeded(response, message_id):
            failed.append(message_id)
    return failed
