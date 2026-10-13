from datetime import datetime, timezone

from inspect_queues import first_row, format_row, started_since

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


def test_first_row_turns_an_insights_result_into_a_dict_without_the_pointer():
    results = [[{"field": "batches", "value": "3"}, {"field": "maxMs", "value": "31234"}, {"field": "@ptr", "value": "x"}]]

    assert first_row(results) == {"batches": "3", "maxMs": "31234"}


def test_first_row_of_no_results_is_empty():
    assert first_row([]) == {}


def test_format_row_rounds_numbers_and_says_when_there_is_nothing():
    assert format_row({"batches": "3", "avgMs": "1234.5678"}) == "batches=3 avgMs=1235"
    assert format_row({}) == "none"
