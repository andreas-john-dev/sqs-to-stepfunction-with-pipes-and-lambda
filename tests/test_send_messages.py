import pytest

from send_messages import message_body, send_batches


def test_a_case_becomes_the_simulate_field():
    assert message_body("fail") == {"simulate": "fail"}


def test_slow_takes_the_sleep_seconds_after_a_colon():
    assert message_body("slow:30") == {"simulate": "slow", "sleepSeconds": 30}


def test_slow_without_seconds_leaves_the_default_to_the_worker():
    assert message_body("slow") == {"simulate": "slow"}


@pytest.mark.parametrize("case", ["oops", "fail:3", "slow:abc", "slow:-1"])
def test_rejects_cases_the_worker_does_not_know(case):
    with pytest.raises(ValueError):
        message_body(case)


def test_one_batch_call_per_10_messages():
    calls = []

    send_batches(lambda batch: calls.append(batch) or {"Successful": []}, [{"simulate": "ok"}] * 23)

    assert [len(c) for c in calls] == [10, 10, 3]


def test_entries_have_unique_ids_and_json_bodies():
    calls = []

    send_batches(lambda batch: calls.append(batch) or {"Successful": []}, [{"simulate": "ok"}, {"simulate": "fail"}])

    assert calls[0] == [
        {"Id": "0", "MessageBody": '{"simulate": "ok"}'},
        {"Id": "1", "MessageBody": '{"simulate": "fail"}'},
    ]


def test_raises_if_sqs_rejects_a_message():
    with pytest.raises(RuntimeError, match="Throttled"):
        send_batches(lambda batch: {"Successful": [], "Failed": [{"Id": "0", "Code": "Throttled"}]}, [{"simulate": "ok"}])
