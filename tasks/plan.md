# Implementation Plan: Lambda scenarios L1–L5

Spec: the private plan doc (German, link in `CLAUDE.local.md`), sections
"Szenario-Matrix", "Python-Code", "Fehlerbehandlung und Testnachrichten",
"Testablauf" and "Offene Punkte".

## Overview

A dispatcher Lambda reads the source queue of L1–L5 through an event source
mapping (ESM) and starts the workflow. Queues, workflows and worker exist
and are deployed; this plan adds the four dispatcher handlers, their CDK
wiring, and a test run in AWS like for P1–P4.

| Scenario | Handler | Calls | Reports failures |
|---|---|---|---|
| L1 | `dispatcher/start_async.py`, mode `per-record` | `StartExecution` per record, name = messageId | records whose start failed |
| L2 | `dispatcher/start_async.py`, mode `batch` | one `StartExecution` with the batch | start fails → whole batch back |
| L3 | `dispatcher/start_sync_sequential.py` | `StartSyncExecution` per record, one after the other | records whose execution is not SUCCEEDED |
| L4 | `dispatcher/start_sync_parallel.py` | same as L3, in parallel with aioboto3 | same as L3 |
| L5 | `dispatcher/start_sync_batch.py` | one `StartSyncExecution` with the batch | `batchItemFailures` from the output; all records if the execution is not SUCCEEDED |

## Architecture Decisions

- **Testable core per handler:** each handler is a thin `handler(event, context)`
  that builds the client and calls a function `dispatch(records, client, arn)`.
  Unit tests pass a small fake client, no AWS and no mocking library.
- **`common/batch_response.py`:** builds `{"batchItemFailures": [...]}` from
  message ids. All dispatchers use it.
- **L1 idempotency:** `ExecutionAlreadyExists` counts as success. A message that
  SQS delivers twice does not start a second execution.
- **Input to the workflows:** L1, L3 and L4 send the record itself; L2 and L5
  send the list of records. The workflows accept both shapes already.
- **One `DispatcherFunction` construct:** `PythonFunction` on the same code
  asset as the worker, handler and env (`STATE_MACHINE_ARN`, `START_MODE`)
  from the scenario, ESM with batch size and window from `scenarios.ts` and
  `reportBatchItemFailures: true`, `grantStartExecution` for async and
  `grantStartSyncExecution` for sync.
- **Dispatcher timeout stays 1 min** (`DISPATCHER_TIMEOUT`), as the doc plans
  it: the `slow` test with 10 × 30 s breaks L3 (300 s in a row) and passes in
  L4 (about 30 s in parallel). Visibility timeout of the L queues stays 6 min.
- **aioboto3 in L4** as in the doc: `asyncio.Semaphore(10)`, `AioConfig` with
  `read_timeout` above 300 s, `max_pool_connections` ≥ the semaphore,
  `retries` mode `adaptive`; session at module level, client per invocation.
- **Measuring L3 vs L4:** each dispatcher logs one line per batch with the
  number of records, failures and the duration.

## Task List

- [x] Task 1: Shared batch response and the async dispatcher (L1, L2)
- [ ] Task 2: `DispatcherFunction` construct, stack wires L1 and L2
- [ ] Task 3: Sync dispatchers L3 and L5, wired into the stack
- [ ] Task 4: Parallel dispatcher L4 with aioboto3, wired into the stack
- [ ] Checkpoint: tests, build, synth; review with human
- [ ] Task 5: Deploy (after approval), run L1–L5, record the results

---

## Task 1: Shared batch response and the async dispatcher (L1, L2)

**Description:** `src/common/batch_response.py` and
`src/dispatcher/start_async.py` with `START_MODE` `per-record` or `batch`.

**Acceptance criteria:**
- [x] `per-record`: one `StartExecution` per record, name = messageId, input = the record
- [x] `per-record`: `ExecutionAlreadyExists` counts as success; any other error reports only that record
- [x] `batch`: one `StartExecution` with all records; an error is raised, so the whole batch comes back
- [x] One log line per batch: records, failures, duration

**Verification:** `pytest`

**Dependencies:** None

**Files likely touched:** `src/common/batch_response.py`, `src/dispatcher/__init__.py`,
`src/dispatcher/start_async.py`, `tests/test_batch_response.py`, `tests/test_start_async.py`

**Estimated scope:** S

## Task 2: `DispatcherFunction` construct, stack wires L1 and L2

**Description:** `cdk/lib/constructs/dispatcher-function.ts` creates the
dispatcher for one scenario; the stack adds it for every selected Lambda
scenario. Handlers that do not exist yet make the construct throw.

**Acceptance criteria:**
- [ ] ESM on the source queue: batch size, window from the scenario, `ReportBatchItemFailures`
- [ ] Env `STATE_MACHINE_ARN` (and `START_MODE` for L1/L2), timeout 1 min
- [ ] Role may call `states:StartExecution` (async) or `states:StartSyncExecution` (sync) on its workflow only
- [ ] Without filter: one dispatcher per wired L scenario; P scenarios get none

**Verification:** `npm test`, `npm run build`, `npx cdk synth`

**Dependencies:** Task 1

**Files likely touched:** `cdk/lib/constructs/dispatcher-function.ts`,
`cdk/test/dispatcher-function.test.ts`, `cdk/lib/sqs-sfn-stack.ts`, `cdk/test/sqs-sfn-stack.test.ts`

**Estimated scope:** M

## Task 3: Sync dispatchers L3 and L5, wired into the stack

**Description:** `start_sync_sequential.py` (L3) and `start_sync_batch.py` (L5)
with boto3; the construct knows their handlers.

**Acceptance criteria:**
- [ ] L3: `StartSyncExecution` per record in a loop; status ≠ SUCCEEDED reports the record
- [ ] L5: one call with the batch; passes `batchItemFailures` from the output through; status ≠ SUCCEEDED reports all records
- [ ] boto3 client with `read_timeout` above 300 s, so a long Express run does not cut the call

**Verification:** `pytest`, `npm test`, `npm run build`

**Dependencies:** Task 2

**Files likely touched:** `src/dispatcher/start_sync_sequential.py`, `src/dispatcher/start_sync_batch.py`,
tests for both, `cdk/lib/constructs/dispatcher-function.ts`, its test

**Estimated scope:** M

## Task 4: Parallel dispatcher L4 with aioboto3, wired into the stack

**Description:** `start_sync_parallel.py` with `asyncio.gather`, bounded by a
semaphore.

**Acceptance criteria:**
- [ ] Same result as L3 for the same records (shared status check)
- [ ] At most 10 calls at a time (test with a fake client that counts open calls)
- [ ] `AioConfig` as in the doc; client created per invocation in `async with`

**Verification:** `pytest`, `npm test`, `npm run build`

**Dependencies:** Task 3

**Files likely touched:** `src/dispatcher/start_sync_parallel.py`, `tests/test_start_sync_parallel.py`,
`cdk/lib/constructs/dispatcher-function.ts`, its test

**Estimated scope:** M

## Checkpoint: after Tasks 1–4

- [ ] `pytest`, `npm test`, `npm run build`, `npx cdk synth` pass
- [ ] Review with human (`/agent-skills:review`)

## Task 5: Run L1–L5 in AWS

**Description:** After deploy approval: `ok fail transient` to each L
scenario, and the `slow` test with 10 × `slow:30` in L3 and L4. Duplicate
test for L1: invoke the L1 dispatcher twice with the same record
(`aws lambda invoke`); the second call must not start a new execution.

**Acceptance criteria:**
- [ ] Results in the doc's expectation table, findings in the outline
- [ ] L3 vs L4 duration from the dispatcher log line
- [ ] Open points "records of pipe and ESM identical" and "aioboto3 cold start" answered

**Dependencies:** Checkpoint

**Estimated scope:** S (mostly waiting and writing down)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| aioboto3 15.5.0 needs a different botocore than boto3 1.40.61 | Med | pins are installed together in `.venv` already (aiobotocore 2.25.1, botocore 1.40.61); bundling uses the same `requirements.txt` |
| 5 `PythonFunction`s bundle the same asset 5 times | Low (slower synth) | same source hash; check synth time, else share one `Code` asset |
| L3 `slow` test hits the 1 min timeout and the whole batch comes back 3 times | expected | that is the point of the test; wait for the DLQ |
| `ExecutionAlreadyExists` only within 90 days for Standard | Low | one sentence in the post |

## Decisions (approved 2026-10-13)

- Dispatcher timeout 1 min for all L scenarios, L5 included. The post says
  in one sentence that L5 could take up to 5 min.

## Status

Plan approved. Task 1 done (async dispatcher, not wired yet). Next:
`/agent-skills:build` Task 2.
