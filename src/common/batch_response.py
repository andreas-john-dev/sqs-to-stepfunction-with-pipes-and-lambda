"""Partial batch response for the Lambda event source mapping, and one log line per batch.

Needs ReportBatchItemFailures on the event source mapping, else Lambda
ignores the response: https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html
"""

import json


def batch_response(failed_message_ids: list) -> dict:
    """Only these messages come back to the queue; SQS deletes the others."""
    return {"batchItemFailures": [{"itemIdentifier": message_id} for message_id in failed_message_ids]}


def log_batch(records: int, failures: int, started: float, now: float) -> None:
    """One JSON line per batch, so CloudWatch Logs Insights can compare the dispatchers."""
    print(json.dumps({"records": records, "failures": failures, "durationMs": round((now - started) * 1000)}))
