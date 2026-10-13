import json

from common.batch_response import batch_response, log_batch


def test_lists_the_failed_message_ids():
    assert batch_response(["a", "b"]) == {"batchItemFailures": [{"itemIdentifier": "a"}, {"itemIdentifier": "b"}]}


def test_no_failures_gives_an_empty_list():
    assert batch_response([]) == {"batchItemFailures": []}


def test_logs_one_json_line_per_batch(capsys):
    log_batch(records=10, failures=2, started=100.0, now=100.25)

    assert json.loads(capsys.readouterr().out) == {"records": 10, "failures": 2, "durationMs": 250}
