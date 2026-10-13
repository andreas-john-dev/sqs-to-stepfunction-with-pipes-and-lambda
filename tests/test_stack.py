import pytest

from stack import outputs_of

OUTPUTS = {
    "P4SourceQueueUrl": "https://sqs/p4",
    "P4PipeName": "pipe-p4",
    "P3SourceQueueUrl": "https://sqs/p3",
}


def test_returns_the_outputs_of_one_scenario_without_prefix():
    assert outputs_of("P4", OUTPUTS) == {"SourceQueueUrl": "https://sqs/p4", "PipeName": "pipe-p4"}


def test_accepts_the_scenario_in_lower_case():
    assert outputs_of("p4", OUTPUTS)["PipeName"] == "pipe-p4"


def test_fails_for_a_scenario_that_is_not_deployed():
    with pytest.raises(SystemExit, match="L1"):
        outputs_of("L1", OUTPUTS)
