# SQS to Step Functions with EventBridge Pipes and Lambda

Companion code for a blog post on [andi-john-dev.de](https://andi-john-dev.de/blog).
It shows how SQS messages can start a Step Functions workflow, either through
EventBridge Pipes or through a dispatcher Lambda, and what that means for error
handling and throughput.

Work in progress: the repo is set up, the scenarios come next.

## Layout

| Path | Content |
| --- | --- |
| `cdk/` | CDK app in TypeScript, one stack with all scenarios |
| `src/` | Python code for the Lambda functions |
| `tests/` | Unit tests for the Python code |
| `scripts/` | Scripts to send test messages and inspect queues |
| `docs/` | Diagrams |

## Requirements

- Node.js 20 or newer
- Python 3.14
- Docker (the CDK bundles the Python Lambdas in a container)
- An AWS account with a bootstrapped CDK environment

## Setup

```bash
# Python
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

# CDK
cd cdk
npm ci
```

## Commands

```bash
pytest                    # Python unit tests (repo root)
# with the stack deployed:
python scripts/send_messages.py --scenario P4 ok fail transient slow:30   # one message per case
python scripts/inspect_queues.py --scenario P4 --minutes 30              # queues, pipe, executions
python scripts/smoke_workflows.py   # start the 4 workflow types directly

cd cdk
npm test                  # CDK tests
npm run build             # type-check the CDK app
npx cdk synth             # synthesize the CloudFormation template
npx cdk deploy            # deploy the stack
npx cdk destroy           # remove the stack
```
