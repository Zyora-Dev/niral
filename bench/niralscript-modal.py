import json
import os
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

import modal


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "node:25.6.1-bookworm-slim"
image = (
    modal.Image.from_registry(IMAGE, add_python="3.11")
    .run_commands(
        "npm install --prefix /opt/bench-tooling --no-audit --no-fund "
        "--ignore-scripts typescript@5.7.3"
    )
)
if modal.is_local():
    sources = [ROOT / "package.json", ROOT / "bench/niralscript.js"]
    for directory in [ROOT / "src", ROOT / "niralscript"]:
        sources.extend(sorted(directory.rglob("*.js")))
    for source in sources:
        if source.is_symlink():
            raise ValueError(f"Refusing to upload a symlink: {source}")
        image = image.add_local_file(source, "/workspace/" + source.relative_to(ROOT).as_posix())

app = modal.App("niral-language-benchmark")


@app.function(image=image, cpu=2, memory=2048, timeout=360)
def benchmark(repeats: int = 3, warmup: int = 2000, compare_warmup: bool = False) -> str:
    if not 1 <= repeats <= 5:
        raise ValueError("Use between one and five fresh Node processes")
    if not 0 <= warmup <= 10000:
        raise ValueError("Warmup must be between zero and 10000 calls")
    workspace = Path("/workspace")
    sources = [workspace / "package.json", workspace / "bench/niralscript.js"]
    for directory in [workspace / "src", workspace / "niralscript"]:
        sources.extend(sorted(directory.rglob("*.js")))
    hashes = {
        source.relative_to(workspace).as_posix(): sha256(source.read_bytes()).hexdigest()
        for source in sources
    }
    reports = []
    schedule = []
    for repeat in range(repeats):
        warmups = [30, warmup] if compare_warmup else [warmup]
        if repeat % 2:
            warmups.reverse()
        schedule.extend((repeat + 1, calls) for calls in warmups)
    for ordinal, (pair, warmup_calls) in enumerate(schedule, start=1):
        print(f"Starting fresh Node process {ordinal}/{len(schedule)}, warmup={warmup_calls}", flush=True)
        execution = subprocess.run(
            ["node", "bench/niralscript.js", "language"],
            cwd=workspace,
            env={
                **os.environ,
                "NIRAL_BENCH_JSON": "1",
                "NIRAL_BENCH_WARMUP": str(warmup_calls),
                "NIRAL_TSC": "/opt/bench-tooling/node_modules/typescript/lib/typescript.js",
            },
            capture_output=True,
            text=True,
            timeout=100,
        )
        if execution.returncode:
            print(execution.stdout, flush=True)
            print(execution.stderr, flush=True)
            raise RuntimeError(f"Benchmark process exited with {execution.returncode}")
        prefix = "NIRAL_BENCH_RESULT="
        lines = [line for line in execution.stdout.splitlines() if line.startswith(prefix)]
        if len(lines) != 1:
            raise RuntimeError("Expected one successful JSON benchmark report")
        report = json.loads(lines[0][len(prefix):])
        if report["node"] != "v25.6.1" or report["typescript"] != "5.7.3":
            raise RuntimeError("Unexpected benchmark toolchain version")
        if report["warmup"] != warmup_calls:
            raise RuntimeError("Unexpected runtime warmup count")
        if len(report["measurements"]) != 6 or any(
            result["correctness"] != "passed" for result in report["measurements"]
        ):
            raise RuntimeError("Not all six workloads passed")
        reports.append({**report, "pair": pair, "executionOrdinal": ordinal})
        print(f"Completed process {ordinal}: all six workloads passed", flush=True)
    return json.dumps({
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "Modal",
        "image": IMAGE,
        "requestedCpuCores": 2,
        "requestedMemoryMiB": 2048,
        "design": "Sequential fresh Node processes in one temporary Modal container; not independent hosts",
        "compareWarmup": compare_warmup,
        "warmupSchedule": [calls for _, calls in schedule],
        "sourceSha256": hashes,
        "runs": reports,
    }, indent=2)