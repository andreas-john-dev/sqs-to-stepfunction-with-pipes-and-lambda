"""Dispatcher for L4: one sync Express execution per record, all at once.

Same result as L3, but the calls run in parallel with aioboto3, at most
MAX_PARALLEL at a time. Ten records that take 30 seconds each need about
30 seconds instead of 300.
"""

import asyncio
import json
import os
import time

import aioboto3
from aiobotocore.config import AioConfig
from botocore.exceptions import ClientError

from common.batch_response import batch_response, log_batch
from dispatcher.sync_result import READ_TIMEOUT_SECONDS, succeeded

MAX_PARALLEL = 10

CONFIG = AioConfig(
    read_timeout=READ_TIMEOUT_SECONDS,
    # One connection per parallel call, else the calls wait for a free one.
    max_pool_connections=MAX_PARALLEL,
    retries={"mode": "adaptive"},
)

# The session can live across invocations. The client cannot: it belongs to
# the event loop, and asyncio.run() makes a new loop per invocation.
session = aioboto3.Session()


def handler(event: dict, context) -> dict:
    started = time.monotonic()
    records = event["Records"]

    failed = asyncio.run(start_all(records, os.environ["STATE_MACHINE_ARN"]))

    log_batch(len(records), len(failed), started, time.monotonic())
    return batch_response(failed)


async def start_all(records: list, arn: str) -> list:
    async with session.client("stepfunctions", config=CONFIG) as sfn:
        return await dispatch(records, sfn, arn)


async def dispatch(records: list, sfn, arn: str) -> list:
    """Returns the messageIds whose execution did not succeed."""
    semaphore = asyncio.Semaphore(MAX_PARALLEL)

    async def start(record: dict) -> str | None:
        message_id = record["messageId"]
        async with semaphore:
            try:
                response = await sfn.start_sync_execution(stateMachineArn=arn, input=json.dumps(record))
            except ClientError as error:
                print(f"{message_id}: {error}")
                return message_id
        return None if succeeded(response, message_id) else message_id

    results = await asyncio.gather(*(start(record) for record in records))
    return [message_id for message_id in results if message_id]
