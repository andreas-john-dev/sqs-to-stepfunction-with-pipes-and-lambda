from dispatcher import sync_result
from dispatcher.sync_result import succeeded


def test_only_succeeded_counts_as_success(capsys):
    assert succeeded({"status": "SUCCEEDED"}, "m1")
    assert not succeeded({"status": "FAILED", "error": "PermanentError", "cause": "bad"}, "m2")

    assert "m2: FAILED PermanentError bad" in capsys.readouterr().out


def test_client_waits_longer_than_an_express_execution_may_run(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    sync_result.sfn_client.cache_clear()

    assert sync_result.sfn_client().meta.config.read_timeout > 300
    sync_result.sfn_client.cache_clear()
