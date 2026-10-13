"""Show what happened in a scenario: queue counts, pipe state, executions.

Executions count only if they started in the last --minutes. Queue
counts are approximate and lag a few seconds. Express executions have no
history, so for them the script sums the CloudWatch metrics instead; the
metrics lag about a minute.

Usage (repo root, venv active):
    python scripts/inspect_queues.py --scenario P4 [--minutes 30]
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone

import boto3

from stack import scenario_outputs

QUEUES = {"source": "SourceQueueUrl", "dlq": "DlqUrl", "error queue": "ErrorQueueUrl"}
EXPRESS_METRICS = ("ExecutionsStarted", "ExecutionsSucceeded", "ExecutionsFailed", "ExecutionsTimedOut")


def print_queues(outputs: dict) -> None:
    sqs = boto3.client("sqs")
    print("Queues (visible / in flight):")
    for name, key in QUEUES.items():
        if key not in outputs:
            continue
        attributes = sqs.get_queue_attributes(
            QueueUrl=outputs[key],
            AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        )["Attributes"]
        print(f"  {name:12} {attributes['ApproximateNumberOfMessages']:>4} / {attributes['ApproximateNumberOfMessagesNotVisible']}")


def print_pipe(outputs: dict) -> None:
    if "PipeName" in outputs:
        pipe = boto3.client("pipes").describe_pipe(Name=outputs["PipeName"])
        print(f"Pipe {pipe['Name']}: {pipe['CurrentState']}")


def started_since(pages, since: datetime) -> list:
    """Executions from ListExecutions pages (newest first) that started at or after `since`."""
    result = []
    for page in pages:
        for execution in page["executions"]:
            if execution["startDate"] < since:
                return result
            result.append(execution)
    return result


def print_standard_executions(arn: str, minutes: int) -> None:
    pages = boto3.client("stepfunctions").get_paginator("list_executions").paginate(stateMachineArn=arn)
    executions = started_since(pages, datetime.now(timezone.utc) - timedelta(minutes=minutes))
    counts = Counter(e["status"] for e in executions)
    print(f"Executions in the last {minutes} min: {dict(counts)}")
    for e in executions[:10]:
        print(f"  {e['startDate']:%H:%M:%S}  {e['status']:10} {e['name']}")


def print_express_metrics(arn: str, minutes: int) -> None:
    cloudwatch = boto3.client("cloudwatch")
    end = datetime.now(timezone.utc)
    print(f"Executions in the last {minutes} min (CloudWatch):")
    for metric in EXPRESS_METRICS:
        points = cloudwatch.get_metric_statistics(
            Namespace="AWS/States",
            MetricName=metric,
            Dimensions=[{"Name": "StateMachineArn", "Value": arn}],
            StartTime=end - timedelta(minutes=minutes),
            EndTime=end,
            Period=60,
            Statistics=["Sum"],
        )["Datapoints"]
        print(f"  {metric:20} {int(sum(p['Sum'] for p in points))}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", required=True, help="e.g. P4")
    parser.add_argument("--minutes", type=int, default=30, help="only executions started in this window")
    args = parser.parse_args()

    outputs = scenario_outputs(args.scenario)
    print_queues(outputs)
    print_pipe(outputs)
    arn = outputs["StateMachineArn"]
    if boto3.client("stepfunctions").describe_state_machine(stateMachineArn=arn)["type"] == "EXPRESS":
        print_express_metrics(arn, args.minutes)
    else:
        print_standard_executions(arn, args.minutes)


if __name__ == "__main__":
    main()
