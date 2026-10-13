import pytest

from worker import process_message
from worker.process_message import PermanentError, TransientError, handler


def make_event(body, receive_count="1", retry_count=0):
    return {
        "record": {
            "messageId": "msg-1",
            "body": body,
            "attributes": {"ApproximateReceiveCount": receive_count},
        },
        "retryCount": retry_count,
    }


@pytest.fixture
def sleeps(monkeypatch):
    calls = []
    monkeypatch.setattr(process_message.time, "sleep", calls.append)
    return calls


def test_ok_returns_a_result_with_the_message_id():
    result = handler(make_event('{"simulate": "ok"}'), None)

    assert result == {"messageId": "msg-1", "status": "ok", "attempt": 1}


def test_body_without_simulate_counts_as_ok():
    result = handler(make_event('{"orderId": 42}'), None)

    assert result["status"] == "ok"


def test_fail_raises_permanent_error():
    with pytest.raises(PermanentError):
        handler(make_event('{"simulate": "fail"}'), None)


def test_unknown_simulate_value_raises_permanent_error():
    with pytest.raises(PermanentError):
        handler(make_event('{"simulate": "explode"}'), None)


def test_slow_sleeps_for_sleep_seconds_from_the_body(sleeps):
    result = handler(make_event('{"simulate": "slow", "sleepSeconds": 7}'), None)

    assert sleeps == [7]
    assert result["status"] == "ok"


def test_slow_uses_the_default_from_the_environment(sleeps, monkeypatch):
    monkeypatch.setenv("DEFAULT_SLEEP_SECONDS", "4")

    handler(make_event('{"simulate": "slow"}'), None)

    assert sleeps == [4]


@pytest.mark.parametrize("receive_count", ["1", "2"])
def test_transient_fails_on_the_first_two_sqs_deliveries(receive_count):
    with pytest.raises(TransientError):
        handler(make_event('{"simulate": "transient"}', receive_count=receive_count), None)


def test_transient_succeeds_on_the_third_sqs_delivery():
    result = handler(make_event('{"simulate": "transient"}', receive_count="3"), None)

    assert result == {"messageId": "msg-1", "status": "ok", "attempt": 3}


def test_transient_succeeds_on_the_second_workflow_retry():
    result = handler(make_event('{"simulate": "transient"}', retry_count=2), None)

    assert result["attempt"] == 3


def test_attempt_is_the_larger_of_receive_count_and_retry_count_plus_1():
    result = handler(make_event('{"simulate": "ok"}', receive_count="2", retry_count=3), None)

    assert result["attempt"] == 4


def test_retry_count_is_optional():
    event = make_event('{"simulate": "ok"}')
    del event["retryCount"]

    assert handler(event, None)["attempt"] == 1
