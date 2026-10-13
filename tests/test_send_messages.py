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


def fake_sqs(calls):
    """Accepts every entry, like SendMessageBatch, and gives it a message id."""
    def send_batch(entries):
        calls.append(entries)
        return {"Successful": [{"Id": e["Id"], "MessageId": f"msg-{e['Id']}"} for e in entries]}
    return send_batch


def test_one_batch_call_per_10_messages():
    calls = []

    send_batches(fake_sqs(calls), [{"simulate": "ok"}] * 23)

    assert [len(c) for c in calls] == [10, 10, 3]


def test_entries_have_unique_ids_and_json_bodies():
    calls = []

    send_batches(fake_sqs(calls), [{"simulate": "ok"}, {"simulate": "fail"}])

    assert calls[0] == [
        {"Id": "0", "MessageBody": '{"simulate": "ok"}'},
        {"Id": "1", "MessageBody": '{"simulate": "fail"}'},
    ]


def test_returns_the_message_ids_in_the_order_of_the_cases():
    assert send_batches(fake_sqs([]), [{"simulate": "ok"}] * 12)[9:] == ["msg-9", "msg-10", "msg-11"]


def test_raises_if_sqs_rejects_a_message():
    with pytest.raises(RuntimeError, match="Throttled"):
        send_batches(lambda batch: {"Successful": [], "Failed": [{"Id": "0", "Code": "Throttled"}]}, [{"simulate": "ok"}])


def test_padding_makes_the_body_bigger_without_changing_the_case():
    body = message_body("ok", pad_bytes=1000)

    assert body["simulate"] == "ok"
    assert len(body["padding"]) == 1000


def test_no_padding_by_default():
    assert "padding" not in message_body("ok")
