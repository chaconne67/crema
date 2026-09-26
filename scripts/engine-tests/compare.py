"""Compares the pruned engine's upstream tests with the same tests on the upstream base.

Usage: python compare.py <pruned report dir> <upstream report dir> <out dir>
Report dirs hold crema_report.py's JSON lines. Writes summary.md (per category) and only-pruned.tsv
(tests failing only in the pruned tree, grouped by error kind) into <out dir>.

Categories: 핵심 = a test file named after a module on Crema's traced run path (core-modules.txt,
from running every surface Crema uses), 전체 = the other test files both trees have, 삭제 = test files
only upstream has (features the prune removed).
"""
import collections
import json
import re
import sys
from pathlib import Path

RANK = {"pass": 0, "skip": 1, "fail": 2, "error": 3}
BAD = {"fail", "error"}


def outcomes(folder):
    out = {}
    for path in Path(folder).rglob("*.jsonl"):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            node = record["id"].replace("\\", "/")
            status = {"passed": "pass", "skipped": "skip"}.get(record["outcome"])
            status = status or ("fail" if record["when"] == "call" else "error")
            old = out.get(node)
            if old is None or RANK[status] > RANK[old[0]]:
                out[node] = (status, record.get("msg", ""))
    return out


def signature(message):
    message = re.sub(r"'[^']{0,80}'", "'…'", message)
    return re.sub(r"\d+", "N", message)[:110]


def main(pruned_dir, upstream_dir, out_dir):
    here = Path(__file__).parent
    used = [line.strip() for line in (here / "core-modules.txt").read_text(encoding="utf-8").splitlines() if line.strip()]
    bases = {Path(p).stem if Path(p).stem != "__init__" else Path(p).parent.name for p in used}
    pruned, upstream = outcomes(pruned_dir), outcomes(upstream_dir)
    file_of = lambda node: node.split("::")[0]
    pruned_files = {file_of(node) for node in pruned}

    def category(file):
        if file not in pruned_files:
            return "삭제"
        stem = Path(file).stem
        name = stem[len("test_"):] if stem.startswith("test_") else stem
        return "핵심" if any(name == base or name.startswith(base + "_") for base in bases) else "전체"

    counts = collections.defaultdict(collections.Counter)
    only_pruned = []
    for node in sorted(set(pruned) | set(upstream)):
        p, u = pruned.get(node, ("missing", "")), upstream.get(node, ("missing", ""))
        cat = category(file_of(node))
        c = counts[cat]
        c["tests"] += 1
        c[f"줄인 쪽 {p[0]}"] += 1
        c[f"원본 {u[0]}"] += 1
        if p[0] in BAD and u[0] in BAD:
            c["양쪽 실패"] += 1
        elif p[0] in BAD:
            c["줄인 쪽만 실패"] += 1
            only_pruned.append((cat, file_of(node), node, u[0], re.sub(r"\s+", " ", p[1])[-300:]))
        elif u[0] in BAD:
            c["원본만 실패"] += 1

    keys = ["줄인 쪽 pass", "줄인 쪽 fail", "줄인 쪽 error", "줄인 쪽 skip", "원본 pass", "원본 fail", "원본 error",
            "원본 skip", "원본 missing", "양쪽 실패", "줄인 쪽만 실패", "원본만 실패"]
    lines = ["| 분류 | 테스트 | " + " | ".join(keys) + " |", "|---|---|" + "---|" * len(keys)]
    for cat in ("핵심", "전체", "삭제"):
        lines.append(f"| {cat} | {counts[cat]['tests']} | " + " | ".join(str(counts[cat][k]) for k in keys) + " |")
    groups = collections.defaultdict(list)
    for row in only_pruned:
        groups[(row[0], signature(row[4]))].append(row)
    lines += ["", "## 줄인 쪽만 실패, 원인별", "", "| 분류 | 건수 | 대표 파일 | 오류 |", "|---|---|---|---|"]
    for (cat, sig), rows in sorted(groups.items(), key=lambda item: (item[0][0], -len(item[1]))):
        files = collections.Counter(row[1] for row in rows).most_common(2)
        lines.append(f"| {cat} | {len(rows)} | {', '.join(f'{f} ({n})' for f, n in files)} | {sig.replace('|', '/')} |")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "only-pruned.tsv").write_text("\n".join("\t".join(row) for row in only_pruned) + "\n", encoding="utf-8")
    print("\n".join(lines[:5]))


if __name__ == "__main__":
    main(*sys.argv[1:4])
