"""Measure the Express executions of a scenario from its workflow log.

For a time window: how many executions ended, the first start and the last
end, executions per second, and the most that ran at the same time. The
starts per 10 seconds show how fast the pipe or the dispatcher scales up.

Usage (repo root, venv active):
    python scripts/measure_executions.py --scenario P3 --since 18:10:00 [--until 18:30:00]
"""

import argparse
import json
from datetime import datetime

import boto3

from stack import STACK_NAME

END_EVENTS = ("ExecutionSucceeded", "ExecutionFailed", "ExecutionTimedOut", "ExecutionAborted")
BUCKET_SECONDS = 10


def max_parallel(runs: list) -> int:
    """The most (start, end) runs that overlap. A run that ends when another starts does not overlap."""
    # At the same time, -1 sorts before +1, so the end counts first.
    events = sorted([(start, 1) for start, _ in runs] + [(end, -1) for _, end in runs])
    running = peak = 0
    for _, step in events:
        running += step
        peak = max(peak, running)
    return peak


def starts_per_bucket(starts: list, first: float, size: int) -> list:
    counts = [0] * (int((max(starts) - first) // size) + 1)
    for start in starts:
        counts[int((start - first) // size)] += 1
    return counts


def summarize(starts: dict, ends: dict) -> dict:
    """`starts` and `ends` map an execution ARN to its time in seconds."""
    runs = [(starts[arn], end) for arn, end in ends.items() if arn in starts]
    first, last = min(s for s, _ in runs), max(e for _, e in runs)
    return {
        "executions": len(runs),
        "firstStart": first,
        "lastEnd": last,
        "seconds": round(last - first, 1),
        "perSecond": round(len(runs) / (last - first), 2),
        "maxParallel": max_parallel(runs),
    }


def read_log(scenario: str, since: datetime, until: datetime) -> tuple:
    starts, ends = {}, {}
    pages = boto3.client("logs").get_paginator("filter_log_events").paginate(
        logGroupName=f"/aws/vendedlogs/states/{STACK_NAME}-{scenario}-Workflow",
        startTime=int(since.timestamp() * 1000),
        endTime=int(until.timestamp() * 1000),
    )
    for page in pages:
        for event in page["events"]:
            entry = json.loads(event["message"])
            seconds = int(entry["event_timestamp"]) / 1000
            if entry["type"] == "ExecutionStarted":
                starts[entry["execution_arn"]] = seconds
            elif entry["type"] in END_EVENTS:
                ends[entry["execution_arn"]] = seconds
    return starts, ends


def at_today(clock: str) -> datetime:
    return datetime.combine(datetime.now().date(), datetime.strptime(clock, "%H:%M:%S").time())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", required=True, help="an Express scenario, e.g. P3")
    parser.add_argument("--since", required=True, help="local time HH:MM:SS, today")
    parser.add_argument("--until", help="local time HH:MM:SS, today (default: now)")
    args = parser.parse_args()

    until = at_today(args.until) if args.until else datetime.now()
    starts, ends = read_log(args.scenario.upper(), at_today(args.since), until)
    if not ends:
        raise SystemExit("No finished executions in this window")
    summary = summarize(starts, ends)
    clock = lambda seconds: datetime.fromtimestamp(seconds).strftime("%H:%M:%S")
    print(
        f"{summary['executions']} executions, {clock(summary['firstStart'])} to {clock(summary['lastEnd'])}"
        f" ({summary['seconds']} s), {summary['perSecond']} per second, at most {summary['maxParallel']} at the same time"
    )
    buckets = starts_per_bucket(list(starts.values()), summary["firstStart"], BUCKET_SECONDS)
    print(f"Starts per {BUCKET_SECONDS} s: {buckets}")


if __name__ == "__main__":
    main()
