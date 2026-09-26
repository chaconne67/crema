"""pytest plugin for the engine test comparison: one JSON line per test outcome (and per failed
collection) into $CREMA_REPORT_DIR, one file per process, so every per-file run of upstream's
runner adds to the same record. Load it with `-p crema_report` (its folder on PYTHONPATH)."""
import json
import os


def _write(record):
    folder = os.environ.get("CREMA_REPORT_DIR")
    if folder:
        with open(os.path.join(folder, f"{os.getpid()}.jsonl"), "a", encoding="utf-8") as out:
            out.write(json.dumps(record, ensure_ascii=False) + "\n")


def _message(report):
    """The error line pytest reports for a failure (e.g. "ModuleNotFoundError: No module named …")."""
    crash = getattr(report.longrepr, "reprcrash", None)
    return (getattr(crash, "message", "") or str(report.longrepr))[-500:]


def pytest_runtest_logreport(report):
    if report.when == "call" or not report.passed:
        _write({"id": report.nodeid, "when": report.when, "outcome": report.outcome,
                "msg": _message(report) if report.failed else ""})


def pytest_collectreport(report):
    if report.failed:
        _write({"id": report.nodeid, "when": "collect", "outcome": "error", "msg": str(report.longrepr)[-500:]})
