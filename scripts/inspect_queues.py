"""Show what happened in a scenario: queue counts, pipe or dispatcher, executions.

Executions and dispatcher logs count only for the last --minutes. Queue
counts are approximate and lag a few seconds. Express executions have no
history, so for them the script sums the CloudWatch metrics instead; the
metrics lag about a minute. For L1-L5 the script sums the dispatcher logs
with Logs Insights: the one line per batch (records, failures, duration),
the Lambda REPORT lines (timeouts) and the cold starts.

Usage (repo root, venv active):
    python scripts/inspect_queues.py --scenario P4 [--minutes 30]
"""

import argparse
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import boto3

from stack import scenario_outputs

QUEUES = {"source": "SourceQueueUrl", "dlq": "DlqUrl", "error queue": "ErrorQueueUrl"}
EXPRESS_METRICS = ("ExecutionsStarted", "ExecutionsSucceeded", "ExecutionsFailed", "ExecutionsTimedOut")

DISPATCHER_QUERIES = {
    # The line from common/batch_response.log_batch. A run that timed out writes none.
    "batches": "filter ispresent(durationMs) | stats count(*) as batches, sum(records) as records,"
    " sum(failures) as failures, avg(durationMs) as avgMs, max(durationMs) as maxMs",
    "invocations": 'filter @type = "REPORT" | stats count(*) as invocations, max(@duration) as maxMs',
    "timeouts": "filter @message like /Status: timeout/ | stats count(*) as timeouts",
    "cold starts": "filter ispresent(@initDuration) | stats count(*) as coldStarts, avg(@initDuration) as avgInitMs",
}


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


def print_dispatcher(outputs: dict, minutes: int) -> None:
    if "DispatcherName" not in outputs:
        return
    log_group = f"/aws/lambda/{outputs['DispatcherName']}"
    print(f"Dispatcher logs in the last {minutes} min (Logs Insights):")
    logs = boto3.client("logs")
    end = int(time.time())
    try:
        query_ids = {
            name: logs.start_query(logGroupName=log_group, startTime=end - minutes * 60, endTime=end, queryString=query)[
                "queryId"
            ]
            for name, query in DISPATCHER_QUERIES.items()
        }
    except logs.exceptions.ResourceNotFoundException:
        print("  no logs yet")
        return
    for name, query_id in query_ids.items():
        while (response := logs.get_query_results(queryId=query_id))["status"] in ("Scheduled", "Running"):
            time.sleep(1)
        print(f"  {name:12} {format_row(first_row(response['results']))}")


def first_row(results: list) -> dict:
    """The first row of a Logs Insights result as {field: value}, without the @ptr field."""
    if not results:
        return {}
    return {cell["field"]: cell["value"] for cell in results[0] if cell["field"] != "@ptr"}


def format_row(row: dict) -> str:
    if not row:
        return "none"
    return " ".join(f"{field}={round(float(value))}" for field, value in row.items())


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
    parser.add_argument("--minutes", type=int, default=30, help="time window for executions and dispatcher logs")
    args = parser.parse_args()

    outputs = scenario_outputs(args.scenario)
    print_queues(outputs)
    print_pipe(outputs)
    print_dispatcher(outputs, args.minutes)
    arn = outputs["StateMachineArn"]
    if boto3.client("stepfunctions").describe_state_machine(stateMachineArn=arn)["type"] == "EXPRESS":
        print_express_metrics(arn, args.minutes)
    else:
        print_standard_executions(arn, args.minutes)


if __name__ == "__main__":
    main()
