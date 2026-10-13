"""Send test messages to the source queue of a scenario.

One message per case. A case is what the worker should do:
ok, fail, transient, or slow (slow:30 sleeps 30 seconds).

Usage (repo root, venv active):
    python scripts/send_messages.py --scenario P4 ok fail transient slow:30
"""

import argparse
import json

import boto3

from stack import scenario_outputs

CASES = ("ok", "fail", "transient", "slow")
MAX_BATCH = 10  # SendMessageBatch takes at most 10 messages


def message_body(case: str) -> dict:
    """'slow:30' -> {"simulate": "slow", "sleepSeconds": 30}"""
    name, _, seconds = case.partition(":")
    if name not in CASES:
        raise ValueError(f"Unknown case {case}. Valid: {', '.join(CASES)}")
    if not seconds:
        return {"simulate": name}
    if name != "slow" or not seconds.isdigit():
        raise ValueError(f"Only slow takes seconds, e.g. slow:30, got {case}")
    return {"simulate": name, "sleepSeconds": int(seconds)}


def send_batches(send_batch, bodies: list) -> list:
    """Send the bodies in batches of 10. Returns the SQS message ids in order."""
    message_ids = []
    for start in range(0, len(bodies), MAX_BATCH):
        entries = [
            {"Id": str(i), "MessageBody": json.dumps(body)}
            for i, body in enumerate(bodies[start : start + MAX_BATCH], start)
        ]
        response = send_batch(entries)
        if response.get("Failed"):
            raise RuntimeError(f"SQS rejected messages: {response['Failed']}")
        by_id = {s["Id"]: s["MessageId"] for s in response["Successful"]}
        message_ids += [by_id.get(e["Id"]) for e in entries]
    return message_ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", required=True, help="e.g. P4")
    parser.add_argument("cases", nargs="+", help="ok, fail, transient, slow or slow:<seconds>")
    args = parser.parse_args()

    try:
        bodies = [message_body(case) for case in args.cases]
    except ValueError as error:
        parser.error(str(error))

    queue_url = scenario_outputs(args.scenario)["SourceQueueUrl"]
    sqs = boto3.client("sqs")
    message_ids = send_batches(lambda entries: sqs.send_message_batch(QueueUrl=queue_url, Entries=entries), bodies)
    for case, message_id in zip(args.cases, message_ids):
        print(f"{message_id}  {case}")


if __name__ == "__main__":
    main()
