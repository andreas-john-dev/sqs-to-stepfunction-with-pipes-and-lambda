import asyncio

from dispatcher import start_sync_parallel, start_sync_sequential
from dispatcher.start_sync_parallel import CONFIG, MAX_PARALLEL, dispatch, handler
from fake_sfn import ARN, FakeSyncStepFunctions, by_simulate, record


class FakeAsyncStepFunctions:
    """Async version of the fake. Counts how many calls are open at the same time."""

    def __init__(self, result=by_simulate):
        self.sync = FakeSyncStepFunctions(result)
        self.open = 0
        self.max_open = 0

    async def start_sync_execution(self, **kwargs):
        self.open += 1
        self.max_open = max(self.max_open, self.open)
        try:
            await asyncio.sleep(0.01)
            return self.sync.start_sync_execution(**kwargs)
        finally:
            self.open -= 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, client):
        self.client_args = None
        self._client = client

    def client(self, service, **kwargs):
        self.client_args = (service, kwargs)
        return self._client


MIXED = [record("m1"), record("m2", "fail"), record("m3", "throttle"), record("m4")]


def test_gives_the_same_result_as_the_sequential_dispatcher():
    parallel = asyncio.run(dispatch(MIXED, FakeAsyncStepFunctions(), ARN))
    sequential = start_sync_sequential.dispatch(MIXED, FakeSyncStepFunctions(by_simulate), ARN)

    assert sorted(parallel) == sorted(sequential) == ["m2", "m3"]


def test_runs_the_calls_in_parallel_but_at_most_max_parallel_at_a_time():
    sfn = FakeAsyncStepFunctions()

    asyncio.run(dispatch([record(f"m{i}") for i in range(25)], sfn, ARN))

    assert len(sfn.sync.calls) == 25
    assert sfn.max_open == MAX_PARALLEL


def test_client_waits_for_express_and_has_a_connection_per_parallel_call():
    assert CONFIG.read_timeout > 300
    assert CONFIG.max_pool_connections >= MAX_PARALLEL


def test_handler_creates_the_client_per_invocation_and_returns_the_partial_batch_response(monkeypatch):
    monkeypatch.setenv("STATE_MACHINE_ARN", ARN)
    session = FakeSession(FakeAsyncStepFunctions())
    monkeypatch.setattr(start_sync_parallel, "session", session)

    response = handler({"Records": [record("m1"), record("m2", "fail")]}, None)

    assert response == {"batchItemFailures": [{"itemIdentifier": "m2"}]}
    assert session.client_args == ("stepfunctions", {"config": CONFIG})
