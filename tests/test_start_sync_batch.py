import json

import pytest
from botocore.exceptions import ClientError

from dispatcher import start_sync_batch
from dispatcher.start_sync_batch import dispatch, handler
from fake_sfn import ARN, FakeSyncStepFunctions, record


def succeeded_with(failed_ids):
    """The express-batch workflow: SUCCEEDED, output lists the failed records."""
    output = {"batchItemFailures": [{"itemIdentifier": i} for i in failed_ids]}
    return lambda payload: {"status": "SUCCEEDED", "output": json.dumps(output)}


def test_starts_one_sync_execution_with_the_whole_batch():
    sfn = FakeSyncStepFunctions(succeeded_with([]))

    failed = dispatch([record("m1"), record("m2")], sfn, ARN)

    assert failed == []
    assert len(sfn.calls) == 1
    assert json.loads(sfn.calls[0]["input"]) == [record("m1"), record("m2")]


def test_passes_the_failed_records_from_the_workflow_output_through():
    sfn = FakeSyncStepFunctions(succeeded_with(["m2"]))

    assert dispatch([record("m1"), record("m2"), record("m3")], sfn, ARN) == ["m2"]


@pytest.mark.parametrize("status", ["FAILED", "TIMED_OUT", "ABORTED"])
def test_reports_all_records_if_the_execution_did_not_succeed(status):
    sfn = FakeSyncStepFunctions(lambda payload: {"status": status, "error": "States.Timeout"})

    assert dispatch([record("m1"), record("m2")], sfn, ARN) == ["m1", "m2"]


def test_raises_if_the_call_fails_so_the_whole_batch_comes_back():
    def throttled(payload):
        raise ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow down"}}, "StartSyncExecution")

    with pytest.raises(ClientError):
        dispatch([record("m1")], FakeSyncStepFunctions(throttled), ARN)


def test_handler_returns_the_partial_batch_response(monkeypatch):
    monkeypatch.setenv("STATE_MACHINE_ARN", ARN)
    monkeypatch.setattr(start_sync_batch, "sfn_client", lambda: FakeSyncStepFunctions(succeeded_with(["m1"])))

    assert handler({"Records": [record("m1"), record("m2")]}, None) == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
