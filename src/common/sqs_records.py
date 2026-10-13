"""Helpers for SQS records. Pipes and the Lambda event source mapping send the same format."""

import json


def parse_body(record: dict) -> dict:
    """Return the message body as a dict. A body that is not a JSON object gives an empty dict."""
    try:
        body = json.loads(record["body"])
    except json.JSONDecodeError:
        return {}
    return body if isinstance(body, dict) else {}


def receive_count(record: dict) -> int:
    """How often SQS has delivered this message, starting at 1."""
    return int(record.get("attributes", {}).get("ApproximateReceiveCount", 1))
