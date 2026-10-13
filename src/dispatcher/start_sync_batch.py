"""Dispatcher for L5: one sync Express execution with the whole batch.

The express-batch workflow maps over the records and returns
{"batchItemFailures": [...]}, which goes straight back to Lambda. If the
execution itself fails or times out, all records come back.
"""

import json
import os
import time

from common.batch_response import batch_response, log_batch
from dispatcher.sync_result import sfn_client, succeeded


def handler(event: dict, context) -> dict:
    started = time.monotonic()
    records = event["Records"]

    failed = dispatch(records, sfn_client(), os.environ["STATE_MACHINE_ARN"])

    log_batch(len(records), len(failed), started, time.monotonic())
    return batch_response(failed)


def dispatch(records: list, sfn, arn: str) -> list:
    """Returns the messageIds that failed. A failed call goes up, so the whole batch comes back."""
    response = sfn.start_sync_execution(stateMachineArn=arn, input=json.dumps(records))
    if not succeeded(response, f"Batch of {len(records)}"):
        return [record["messageId"] for record in records]
    return [failure["itemIdentifier"] for failure in json.loads(response["output"])["batchItemFailures"]]
