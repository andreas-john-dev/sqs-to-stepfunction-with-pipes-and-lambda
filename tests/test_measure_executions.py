from measure_executions import max_parallel, starts_per_bucket, summarize


def test_max_parallel_counts_overlapping_runs():
    assert max_parallel([(0, 10), (5, 15), (6, 8)]) == 3


def test_a_run_that_ends_when_another_starts_does_not_overlap():
    assert max_parallel([(0, 10), (10, 20)]) == 1


def test_no_runs_means_no_parallel_runs():
    assert max_parallel([]) == 0


def test_starts_per_bucket_counts_starts_in_each_window():
    assert starts_per_bucket([100, 101, 112, 125], first=100, size=10) == [2, 1, 1]


def test_summarize_uses_only_executions_that_ended():
    starts = {"a": 100.0, "b": 101.0, "c": 102.0}
    ends = {"a": 110.0, "b": 115.0}

    assert summarize(starts, ends) == {
        "executions": 2,
        "firstStart": 100.0,
        "lastEnd": 115.0,
        "seconds": 15.0,
        "perSecond": 0.13,
        "maxParallel": 2,
    }
