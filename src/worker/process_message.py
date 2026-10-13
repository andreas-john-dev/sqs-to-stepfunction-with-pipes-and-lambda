"""Worker Lambda. It stands in for the real business logic of one message.

The body field `simulate` decides what happens:
- `ok` (or no field): return a result
- `fail`: raise PermanentError
- `slow`: sleep for `sleepSeconds`, then return a result
- `transient`: raise TransientError until the third attempt

Input from the workflow: {"record": <SQS record>, "retryCount": <Step Functions retry count>}
"""

import os
import time

from common.sqs_records import parse_body, receive_count

SUCCEED_ON_ATTEMPT = 3


class TransientError(Exception):
    """A failure that goes away on retry."""


class PermanentError(Exception):
    """A failure that a retry does not fix."""


def handler(event: dict, context) -> dict:
    record = event["record"]
    message = parse_body(record)
    # SQS redelivery and workflow retries both count as a new attempt.
    attempt = max(receive_count(record), event.get("retryCount", 0) + 1)

    match message.get("simulate", "ok"):
        case "ok":
            pass
        case "fail":
            raise PermanentError(f"Message {record['messageId']} cannot be processed")
        case "slow":
            time.sleep(message.get("sleepSeconds", int(os.environ.get("DEFAULT_SLEEP_SECONDS", "10"))))
        case "transient":
            if attempt < SUCCEED_ON_ATTEMPT:
                raise TransientError(f"Attempt {attempt} failed, try again")
        case other:
            raise PermanentError(f"Unknown simulate value: {other}")

    return {"messageId": record["messageId"], "status": "ok", "attempt": attempt}
