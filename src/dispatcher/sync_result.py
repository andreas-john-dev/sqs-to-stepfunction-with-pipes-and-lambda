"""Shared by the sync dispatchers L3, L4 and L5."""

import functools

import boto3
from botocore.config import Config

# An Express execution runs up to 5 minutes. The client must wait longer,
# or it cuts the call while the execution still runs.
READ_TIMEOUT_SECONDS = 310


@functools.cache
def sfn_client():
    """boto3 client for L3 and L5. L4 builds its own with aioboto3."""
    return boto3.client(
        "stepfunctions",
        config=Config(read_timeout=READ_TIMEOUT_SECONDS, retries={"mode": "adaptive"}),
    )


def succeeded(response: dict, what: str) -> bool:
    """StartSyncExecution does not raise for a failed execution; only the status tells.

    `what` names the record or batch in the log line.
    """
    if response["status"] == "SUCCEEDED":
        return True
    print(f"{what}: {response['status']} {response.get('error', '')} {response.get('cause', '')}")
    return False
