from common.sqs_records import parse_body, receive_count


def make_record(body, receive_count="1"):
    return {
        "messageId": "msg-1",
        "body": body,
        "attributes": {"ApproximateReceiveCount": receive_count},
    }


def test_parse_body_returns_json_object():
    record = make_record('{"simulate": "fail"}')

    assert parse_body(record) == {"simulate": "fail"}


def test_parse_body_returns_empty_dict_for_plain_text():
    record = make_record("hello")

    assert parse_body(record) == {}


def test_parse_body_returns_empty_dict_for_json_that_is_not_an_object():
    record = make_record("[1, 2]")

    assert parse_body(record) == {}


def test_receive_count_reads_the_sqs_attribute():
    record = make_record("{}", receive_count="3")

    assert receive_count(record) == 3


def test_receive_count_is_1_without_attributes():
    record = {"messageId": "msg-1", "body": "{}"}

    assert receive_count(record) == 1
