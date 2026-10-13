from datetime import datetime, timezone

from inspect_queues import started_since

SINCE = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)


def execution(name, hour, minute):
    return {"name": name, "startDate": datetime(2026, 10, 13, hour, minute, tzinfo=timezone.utc)}


def test_keeps_only_executions_started_in_the_window():
    pages = [{"executions": [execution("new", 12, 30), execution("edge", 12, 0), execution("old", 11, 59)]}]

    assert [e["name"] for e in started_since(pages, SINCE)] == ["new", "edge"]


def test_stops_reading_pages_at_the_first_old_execution():
    def pages():
        yield {"executions": [execution("new", 12, 30), execution("old", 11, 0)]}
        raise AssertionError("read a page it did not need")

    assert [e["name"] for e in started_since(pages(), SINCE)] == ["new"]
