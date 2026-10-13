"""A fake Step Functions client for StartSyncExecution, shared by the dispatcher tests."""

import json

from botocore.exceptions import ClientError

ARN = "arn:aws:states:eu-central-1:123456789012:stateMachine:Express"


def record(message_id, simulate="ok"):
    return {"messageId": message_id, "body": json.dumps({"simulate": simulate})}


class FakeSyncStepFunctions:
    """Runs a function per call to build the response, records the calls.

    `result(payload)` gets the parsed input and returns the response dict,
    or raises.
    """

    def __init__(self, result):
        self.calls = []
        self.result = result

    def start_sync_execution(self, **kwargs):
        self.calls.append(kwargs)
        return self.result(json.loads(kwargs["input"]))


def by_simulate(payload):
    """One record in, SUCCEEDED for ok, FAILED for fail, throttled for throttle."""
    simulate = json.loads(payload["body"])["simulate"]
    if simulate == "throttle":
        raise ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow down"}}, "StartSyncExecution")
    if simulate == "fail":
        return {"status": "FAILED", "error": "PermanentError", "cause": "cannot be processed"}
    return {"status": "SUCCEEDED", "output": json.dumps({"messageId": payload["messageId"]})}
