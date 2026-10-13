# CLAUDE.md

Companion repo for a blog post: SQS messages start a Step Functions workflow,
either through EventBridge Pipes (scenarios P1–P4) or through a dispatcher
Lambda (L1–L5). All scenarios live side by side in one CDK stack.

The plan (German) lives in a private doc outside the repo. If
`CLAUDE.local.md` exists, it has the link. The plan holds the scenario
matrix, the workflows, the error handling, the test flow and the next steps.
Read it before you start a task, and tick off the tasks in "Nächste
Schritte" when they are done. Never write the link into a tracked file.

## Layout

- `cdk/`: CDK app in TypeScript. `bin/app.ts` creates the one stack
  `lib/sqs-sfn-stack.ts`, which wires the scenarios from `lib/scenarios.ts`
  (filter: `-c scenarios=P3,L4`). `lib/constructs/` holds the queues, the
  worker and the four workflow factories (`workflows.ts`). Planned: pipe and
  dispatcher wiring.
- `tasks/`: plan and todo list of the current task (agent-skills `/plan`).
- `src/`: Python 3.14 Lambda code (`worker/`, `dispatcher/`, `common/`). All
  functions share `src/requirements.txt` and are bundled with
  `PythonFunction` from `@aws-cdk/aws-lambda-python-alpha` (needs Docker).
- `tests/`: pytest unit tests. `pyproject.toml` puts `src/` on the path.
- `scripts/`: `smoke_workflows.py` starts the four workflow types directly
  (no pipe, no dispatcher) against the deployed stack. Planned: send test
  messages, inspect queues.

## Commands

```bash
source .venv/bin/activate && pytest     # Python tests, from repo root
cd cdk && npm test                      # CDK tests (node:test + assertions)
cd cdk && npm run build                 # type-check (tsc, strict)
cd cdk && npx cdk synth                 # synth
```

Use `npx cdk` (pinned CLI in `cdk/package.json`), never a global `cdk`.
Always `cdk diff` before `cdk deploy`.

## Conventions

- Code, comments, README and the post are in English, in plain English:
  short sentences, common words. The plan doc stays German.
- Keep the setup simple. The post is about SQS and Step Functions, not about
  repo structure or packaging. No extra tooling without a reason.
- `@aws-cdk/aws-lambda-python-alpha` is pinned to an exact version; keep it in
  step with `aws-cdk-lib`.
- No ESLint for now: `typescript-eslint` does not support TypeScript 7 yet.
  `tsc` with `strict` is the check.

## Skills

- `.claude/skills/aws-cdk`: official AWS CDK skill, copied from
  aws/agent-toolkit-for-aws (see its `SOURCE.md`).
- `.claude/settings.json` enables the `agent-skills` plugin
  (addyosmani/agent-skills): spec, plan, build, test, review workflows.
