# Implementation Plan: Pipe scenarios P1–P4

Spec: the private plan doc (German, link in `CLAUDE.local.md`), sections
"Szenario-Matrix", "Fehler im Workflow behandeln oder scheitern lassen?",
"Fehlerbehandlung" and "Offene Punkte".

## Overview

Connect the source queue of P1–P4 to its workflow with an EventBridge Pipe,
then send real messages through it and record what happens. The workflows,
queues and the worker already exist and are deployed.

## What the AWS docs already answer

- A pipe sends a JSON array to Step Functions, even for batch size 1
  ([batching](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)).
  The single workflows already accept that.
- Partial batch failure for Step Functions targets uses the same payload as
  Lambda: `{"batchItemFailures": [{"itemIdentifier": "<messageId>"}]}`.
  `express-batch` already returns it.
- A pipe execution may run at most 5 minutes, enrichment and target included.
- The Step Functions target has only `InvocationType`, no execution name
  ([API reference](https://docs.aws.amazon.com/eventbridge/latest/pipes-reference/API_PipeTargetStateMachineParameters.html)).
  So no idempotency through the execution name in P1; L1 stays.

## Architecture Decisions

- **CDK L2 alpha modules** `@aws-cdk/aws-pipes-alpha`, `-sources-alpha`,
  `-targets-alpha`, pinned to the exact version like the Python alpha module.
  They are marked experimental, but the code reads much better in the post
  than `CfnPipe` with a hand-written role, and they create the IAM role with
  the right `states:StartExecution` / `states:StartSyncExecution` rights.
- **Invocation type from the scenario:** `async` → `FIRE_AND_FORGET`,
  `sync` → `REQUEST_RESPONSE`. Batch size and batching window from
  `scenarios.ts`.
- **Pipe logs** at level ERROR to a log group per pipe, so failed target
  calls (timeouts, failed executions) show up during the experiments.
- **Test scripts** `send_messages.py` and `inspect_queues.py` come now, in a
  first small version, because the pipes can only be checked with real
  messages. The dispatcher scenarios reuse them later.

## Task List

- [x] Task 1: Pipe construct with tests
- [x] Task 2: Stack creates a pipe for P1–P4
- [x] Task 3: `send_messages.py` and `inspect_queues.py`
- [ ] Checkpoint: tests, build, synth; review with human
- [ ] Task 4: Deploy (after approval), run P1–P4, record the results

---

## Task 1: Pipe construct with tests

**Description:** `cdk/lib/constructs/pipe-integration.ts` creates one pipe
from a scenario's source queue to its state machine.

**Acceptance criteria:**
- [x] Source parameters: batch size and batching window from the scenario
- [x] Target: `FIRE_AND_FORGET` for async, `REQUEST_RESPONSE` for sync
- [x] Pipe role may start the state machine (sync or async API) and read the queue
- [x] Log configuration at level ERROR

**Verification:** `npm test`, `npm run build`

**Dependencies:** None

**Files likely touched:** `cdk/lib/constructs/pipe-integration.ts`,
`cdk/test/pipe-integration.test.ts`, `cdk/package.json`

**Estimated scope:** S

## Task 2: Stack creates a pipe for P1–P4

**Description:** `SqsSfnStack` adds the pipe for every selected scenario with
`integration: 'pipe'`.

**Acceptance criteria:**
- [x] Without filter: 4 pipes; `-c scenarios=L1,L2`: none
- [x] Output per pipe scenario: pipe name

**Verification:** `npm test`, `npm run build`, `npx cdk synth`

**Dependencies:** Task 1

**Files likely touched:** `cdk/lib/sqs-sfn-stack.ts`, `cdk/test/sqs-sfn-stack.test.ts`

**Estimated scope:** XS

## Task 3: `send_messages.py` and `inspect_queues.py`

**Description:** Small CLI scripts on top of the stack outputs.
`send_messages.py --scenario P4 ok fail transient` sends one message per
argument (`slow:30` sets `sleepSeconds`). `inspect_queues.py --scenario P4`
shows the approximate message counts of source queue, DLQ and error queue,
and the last executions by status.

**Acceptance criteria:**
- [x] Message body `{"simulate": ..., "sleepSeconds"?: ...}`, one SendMessageBatch call per 10 messages
- [x] Unit tests for building the message bodies (no AWS calls)

**Verification:** `pytest`

**Dependencies:** None

**Files likely touched:** `scripts/send_messages.py`, `scripts/inspect_queues.py`,
`scripts/stack.py` (shared output lookup), `tests/test_send_messages.py`

**Estimated scope:** M

## Task 4: Run P1–P4 in AWS

**Description:** After deploy approval, send `ok`, `fail`, `transient` and a
mixed batch to each pipe scenario, wait, inspect. Then a short `slow` test
in P3 (e.g. 30 s).

**Acceptance criteria:**
- [ ] Results match the expectation table in the doc, or the doc is updated
      with what really happens
- [ ] Open points 1, 3, 4 confirmed or corrected with real data

**Verification:** `inspect_queues.py` output per scenario, saved in the doc

**Dependencies:** Tasks 2, 3

**Estimated scope:** S (mostly waiting and writing down)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Alpha API changes in a later CDK version | Low | exact pin; the post names the version |
| `transient` in P3 needs 3 SQS receives with 6 min visibility timeout | Med (slow test loop) | for the experiment, set the visibility timeout lower via the scenario config, or wait; decide in Task 4 |
| Pipe retries a failed sync batch as a whole | Med | that is what the experiment should show; record it |

## Decisions (approved 2026-10-13)

- Alpha modules (`aws-pipes-alpha`, `-sources-alpha`, `-targets-alpha`),
  exact pin 2.273.0-alpha.0.
- Visibility timeout of P3/P4 stays 6 min for the test runs (realistic).
  Send the test cases in parallel instead of one after the other.

## Status

Plan approved. Tasks 1–3 done (pipe construct, wired into the stack, test
scripts; pipes not deployed). Next: checkpoint and review with human.
Stack is deployed in eu-central-1 with all 9 scenarios (no pipes, no
dispatchers). Local commits are not pushed; push only when asked.
