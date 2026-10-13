import json

from dispatcher import start_sync_sequential
from dispatcher.start_sync_sequential import dispatch, handler
from fake_sfn import ARN, FakeSyncStepFunctions, by_simulate, record


def test_starts_one_sync_execution_per_record_in_order():
    sfn = FakeSyncStepFunctions(by_simulate)

    failed = dispatch([record("m1"), record("m2")], sfn, ARN)

    assert failed == []
    assert [c["stateMachineArn"] for c in sfn.calls] == [ARN, ARN]
    assert [json.loads(c["input"]) for c in sfn.calls] == [record("m1"), record("m2")]


def test_reports_records_whose_execution_did_not_succeed():
    # StartSyncExecution does not raise for a failed execution; the status tells.
    sfn = FakeSyncStepFunctions(by_simulate)

    failed = dispatch([record("m1"), record("m2", "fail"), record("m3")], sfn, ARN)

    assert failed == ["m2"]


def test_reports_a_record_whose_call_failed_and_goes_on_with_the_rest():
    sfn = FakeSyncStepFunctions(by_simulate)

    failed = dispatch([record("m1", "throttle"), record("m2")], sfn, ARN)

    assert failed == ["m1"]
    assert len(sfn.calls) == 2


def test_handler_returns_the_partial_batch_response(monkeypatch):
    monkeypatch.setenv("STATE_MACHINE_ARN", ARN)
    monkeypatch.setattr(start_sync_sequential, "sfn_client", lambda: FakeSyncStepFunctions(by_simulate))

    response = handler({"Records": [record("m1"), record("m2", "fail")]}, None)

    assert response == {"batchItemFailures": [{"itemIdentifier": "m2"}]}
