import json

import pytest
from botocore.exceptions import ClientError

from dispatcher import start_async
from dispatcher.start_async import dispatch_batch, dispatch_per_record, handler

ARN = "arn:aws:states:eu-central-1:123456789012:stateMachine:L1"


def record(message_id):
    return {"messageId": message_id, "body": '{"simulate": "ok"}'}


class FakeStepFunctions:
    """Records the calls. `errors` maps an execution name to an error code."""

    def __init__(self, errors=None, fail_all_with=None):
        self.calls = []
        self.errors = errors or {}
        self.fail_all_with = fail_all_with

    def start_execution(self, **kwargs):
        self.calls.append(kwargs)
        code = self.fail_all_with or self.errors.get(kwargs.get("name"))
        if code:
            raise ClientError({"Error": {"Code": code, "Message": code}}, "StartExecution")
        return {"executionArn": f"{ARN}:{kwargs.get('name', 'x')}"}


def test_per_record_starts_one_execution_per_record_named_after_the_message_id():
    sfn = FakeStepFunctions()

    failed = dispatch_per_record([record("m1"), record("m2")], sfn, ARN)

    assert failed == []
    assert [c["name"] for c in sfn.calls] == ["m1", "m2"]
    assert json.loads(sfn.calls[0]["input"]) == record("m1")
    assert sfn.calls[0]["stateMachineArn"] == ARN


def test_per_record_counts_an_existing_execution_as_started():
    # SQS delivered the message again; the first delivery already started it.
    sfn = FakeStepFunctions(errors={"m1": "ExecutionAlreadyExists"})

    assert dispatch_per_record([record("m1")], sfn, ARN) == []


def test_per_record_reports_only_the_record_whose_start_failed():
    sfn = FakeStepFunctions(errors={"m2": "ThrottlingException"})

    failed = dispatch_per_record([record("m1"), record("m2"), record("m3")], sfn, ARN)

    assert failed == ["m2"]
    assert len(sfn.calls) == 3


def test_batch_starts_one_execution_with_all_records():
    sfn = FakeStepFunctions()

    failed = dispatch_batch([record("m1"), record("m2")], sfn, ARN)

    assert failed == []
    assert len(sfn.calls) == 1
    assert json.loads(sfn.calls[0]["input"]) == [record("m1"), record("m2")]


def test_batch_raises_if_the_start_fails_so_the_whole_batch_comes_back():
    sfn = FakeStepFunctions(fail_all_with="ThrottlingException")

    with pytest.raises(ClientError):
        dispatch_batch([record("m1"), record("m2")], sfn, ARN)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("STATE_MACHINE_ARN", ARN)
    return monkeypatch


def test_handler_starts_per_record_and_returns_the_partial_batch_response(env):
    sfn = FakeStepFunctions(errors={"m2": "ThrottlingException"})
    env.setattr(start_async, "sfn_client", lambda: sfn)
    env.setenv("START_MODE", "per-record")

    response = handler({"Records": [record("m1"), record("m2")]}, None)

    assert response == {"batchItemFailures": [{"itemIdentifier": "m2"}]}


def test_handler_rejects_an_unknown_mode(env):
    env.setattr(start_async, "sfn_client", FakeStepFunctions)
    env.setenv("START_MODE", "sometimes")

    with pytest.raises(ValueError, match="sometimes"):
        handler({"Records": [record("m1")]}, None)
