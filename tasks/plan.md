# Implementation Plan: Shared constructs (queues, workflows, worker)

Spec: the plan doc (German), sections "Szenario-Matrix", "Architektur",
"Workflows", "Python-Code" and "Fehlerbehandlung":
https://claude.ai/artifact/EFncuRezwAeczfZ1ph3U5Y

## Overview

Build the parts that all 9 scenarios share: the worker Lambda, the queues per
scenario and the four workflow factories (`standard-single`, `standard-batch`,
`express-single`, `express-batch`). Pipes (P1–P4) and dispatcher Lambdas
(L1–L5) are out of scope; they come in the next tasks. At the end the stack
deploys queues and state machines for every scenario, and each state machine
can be started by hand with a sample SQS record.

## Architecture Decisions

- **One worker Lambda** for all workflows. It gets one SQS record plus the
  attempt number and simulates work from `simulate` in the body
  (`ok`, `fail`, `slow`, `transient`).
- **Attempt number** = max(`ApproximateReceiveCount`, `RetryCount + 1` from the
  context object). The workflow passes both values in the task payload, so the
  worker has no Step Functions dependency.
- **JSONata** as query language in all state machines. It normalizes the input
  of the single workflows (record or one-element array) and builds
  `batchItemFailures` after the Map.
- **Retry contrast:** only standard workflows retry `TransientError`
  (3 attempts, backoff) and catch into the error queue. Express workflows have
  no retry and no catch, so SQS redelivery and the DLQ show up in tests.
- **Map:** inline Map, `MaxConcurrency` 10.
- **Express logging:** level ALL with execution data to CloudWatch Logs.
- **Scenario config** in `scenarios.ts`: integration, workflow type, invocation
  mode, batch size, batching window, visibility timeout. Context flag
  `-c scenarios=P3,L4` limits what gets deployed.
- **CDK tests** with `node:test` + `aws-cdk-lib/assertions`, run through `tsx`.
  No Jest, no extra dependency. Bundling is skipped in tests
  (`aws:cdk:bundling-stacks: []`) so they run without Docker.

## Dependency Graph

```
worker (Python) ──► WorkerFunction construct ──┐
                                               ├──► 4 workflow factories ──► stack wiring per scenario
scenarios.ts ──► ScenarioQueues construct ─────┘
```

## Task List

### Phase 1: Foundation

- [x] Task 1: Worker logic in Python with unit tests
- [x] Task 2: Scenario config and queues construct, with CDK test setup
- [x] Task 3: Worker Lambda construct (PythonFunction, Python 3.14)

### Checkpoint: Foundation
- [x] `pytest` passes, `npm test` and `npm run build` pass in `cdk/`
- [x] `npx cdk synth` works (with Docker bundling)

### Phase 2: Workflows

- [ ] Task 4: `express-single` workflow, first deployable slice
- [ ] Task 5: `standard-single` workflow with retry and error queue
- [ ] Task 6: `express-batch` workflow with `batchItemFailures`
- [ ] Task 7: `standard-batch` workflow

### Checkpoint: Workflows
- [ ] All tests pass, synth works
- [ ] Review with human before wiring all scenarios

### Phase 3: Wiring

- [ ] Task 8: Stack creates queues and a workflow for each scenario, with the context filter

### Checkpoint: Complete
- [ ] Deploy (after approval), start each workflow type once by hand with
      `ok`, `fail` and `transient` records
- [ ] Plan doc updated, task ticked off

---

## Task 1: Worker logic in Python with unit tests

**Description:** `worker/process_message.py` takes `{record, attempt}`-style
input: one SQS record plus `retryCount`. It parses the body with
`common/sqs_records.py` and acts on `simulate`. Errors are custom exception
classes, so Step Functions can match them by name (`TransientError`,
`PermanentError`).

**Acceptance criteria:**
- [ ] `ok` returns a result with the `messageId`; `fail` raises `PermanentError`;
      `slow` sleeps `sleepSeconds` (default from env); `transient` raises
      `TransientError` while attempt < 3
- [ ] Attempt = max(`ApproximateReceiveCount`, `retryCount + 1`)
- [ ] Body without `simulate` counts as `ok`

**Verification:**
- [ ] `pytest` passes (tests for each case and the attempt logic)

**Dependencies:** None

**Files likely touched:** `src/worker/process_message.py`,
`src/common/sqs_records.py`, `tests/test_process_message.py`,
`tests/test_sqs_records.py`

**Estimated scope:** S

## Task 2: Scenario config and queues construct, with CDK test setup

**Description:** `scenarios.ts` lists P1–L5 with their settings from the
scenario matrix. `ScenarioQueues` creates the source queue, the SQS DLQ
(`maxReceiveCount` 3) and, for async scenarios, the workflow error queue. Set
up `npm test` with `node:test` and `tsx`.

**Acceptance criteria:**
- [ ] 9 scenarios with integration, workflow type, invocation mode, batch size,
      batching window, visibility timeout
- [ ] Assertion test: source queue has a redrive policy to the DLQ with
      `maxReceiveCount` 3; error queue exists only for async scenarios

**Verification:**
- [ ] `npm test` and `npm run build` pass in `cdk/`

**Dependencies:** None

**Files likely touched:** `cdk/lib/scenarios.ts`,
`cdk/lib/constructs/scenario-queues.ts`, `cdk/test/scenario-queues.test.ts`,
`cdk/package.json`

**Estimated scope:** M

## Task 3: Worker Lambda construct

**Description:** A small construct (or a function in the stack) that creates
the worker as `PythonFunction` with `entry` `src/`, handler
`worker/process_message.handler`, runtime Python 3.14, a timeout that fits
`slow`.

**Acceptance criteria:**
- [ ] Assertion test: one Lambda with runtime `python3.14` and the expected handler
- [ ] `npx cdk synth` bundles `src/` with Docker

**Verification:**
- [ ] `npm test`, `npm run build`, `npx cdk synth`

**Dependencies:** Task 1

**Files likely touched:** `cdk/lib/constructs/worker-function.ts`,
`cdk/test/worker-function.test.ts`

**Estimated scope:** S

## Task 4: `express-single` workflow, first deployable slice

**Description:** Factory in `workflows.ts` for an Express state machine with
JSONata: normalize input (record or one-element array) → invoke worker → return
its result. No retry, no catch. Logging level ALL with execution data.

**Acceptance criteria:**
- [ ] Assertion test: type EXPRESS, query language JSONata, logging ALL
- [ ] No `Retry` or `Catch` in the definition
- [ ] By hand (after deploy approval): `aws stepfunctions start-sync-execution`
      with an `ok` record → SUCCEEDED, with `fail` → FAILED

**Verification:**
- [ ] `npm test`, `npm run build`, `npx cdk synth`

**Dependencies:** Tasks 2, 3

**Files likely touched:** `cdk/lib/constructs/workflows.ts`,
`cdk/test/workflows.test.ts`, `cdk/lib/sqs-sfn-stack.ts`

**Estimated scope:** M

## Task 5: `standard-single` workflow

**Description:** Standard state machine: invoke worker with retry on
`TransientError` (3 attempts, backoff), catch everything else →
`SendMessage` to the error queue.

**Acceptance criteria:**
- [ ] Assertion test: type STANDARD, retry on `TransientError` with 3 attempts
- [ ] Catch sends the record and error to the error queue; role may send to it

**Verification:**
- [ ] `npm test`, `npm run build`

**Dependencies:** Task 4

**Files likely touched:** `cdk/lib/constructs/workflows.ts`,
`cdk/test/workflows.test.ts`

**Estimated scope:** S

## Task 6: `express-batch` workflow

**Description:** Express state machine: inline Map over the records
(`MaxConcurrency` 10), catch per item marks it as failed, then a Pass state
builds `{"batchItemFailures": [{"itemIdentifier": "<messageId>"}]}`.

**Acceptance criteria:**
- [ ] Assertion test: Map with `MaxConcurrency` 10, catch per item
- [ ] Output has exactly the failed `messageId`s (checked by hand with a mixed
      batch after deploy)

**Verification:**
- [ ] `npm test`, `npm run build`

**Dependencies:** Task 4

**Files likely touched:** `cdk/lib/constructs/workflows.ts`,
`cdk/test/workflows.test.ts`

**Estimated scope:** S

## Task 7: `standard-batch` workflow

**Description:** Standard state machine: inline Map, per item the same retry
and catch as `standard-single`; other items keep running. Output not used.

**Acceptance criteria:**
- [ ] Assertion test: Map with retry and catch inside the item processor
- [ ] Catch sends only the failed item to the error queue

**Verification:**
- [ ] `npm test`, `npm run build`

**Dependencies:** Task 5

**Files likely touched:** `cdk/lib/constructs/workflows.ts`,
`cdk/test/workflows.test.ts`

**Estimated scope:** S

## Task 8: Stack wiring per scenario

**Description:** `SqsSfnStack` reads `scenarios.ts` and the context flag
`scenarios`, and creates queues plus the matching workflow per scenario. Pipes
and dispatchers are not wired yet. Outputs: queue URLs and state machine ARNs
per scenario.

**Acceptance criteria:**
- [ ] Without flag: 9 source queues, 9 state machines, one worker
- [ ] `-c scenarios=P3,L4`: only those two
- [ ] Visibility timeout per queue from the config

**Verification:**
- [ ] `npm test`, `npm run build`, `npx cdk synth`

**Dependencies:** Tasks 2–7

**Files likely touched:** `cdk/lib/sqs-sfn-stack.ts`,
`cdk/test/sqs-sfn-stack.test.ts`

**Estimated scope:** S

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| JSONata + CDK L2 support for Map, Retry, Catch has gaps | Med | Use `sfn` L2 with `queryLanguage: JSONATA`; fall back to `DefinitionBody.fromString` for single states if needed |
| Pipe sends an array even for batch size 1 (open point in the doc) | Low | Single workflows accept both shapes |
| Docker bundling slows tests | Low | Tests skip bundling via context |

## Open Questions

- Visibility timeouts per scenario are not yet in the doc as numbers. Proposal:
  Lambda = 6 × function timeout, pipe = max workflow runtime + buffer
  (e.g. 5 min for standard, 2 min for express). Settle in Task 2.
- Deploy for the smoke tests in Tasks 4 and Checkpoint: needs your OK each time.
