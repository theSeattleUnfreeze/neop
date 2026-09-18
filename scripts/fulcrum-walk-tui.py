#!/usr/bin/env python3
"""ASCII monitor for the Fulcrum fork walk.

Shows which leg is active (Knots index down to the fork, then fork up to
the Core tip), the source and destination of that leg, and a progress bar.

  python scripts/fulcrum-walk-tui.py
  python scripts/fulcrum-walk-tui.py --once

--bitcoin-cli is optional. It is the path to the bitcoin-cli.exe program
(Bitcoin Core's RPC client), not a Python function. See --help.

Does not print RPC credentials. Heights come from Fulcrum's own log lines.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from typing import List, Optional, Sequence, Tuple


FORK_HEIGHT = 961631
# First block the rewind undid. Later container restarts do not repeat it.
REWIND_FROM = 972680

RE_TIP = re.compile(r"tip now (\d+)")
RE_STORED = re.compile(r"Rewound via stored undo to height (\d+)")
RE_TARGET = re.compile(r"target height (\d+)")
RE_UNDO = re.compile(
    r"Applied undo for block (\d+).+?(\d+) transactions.+?in ([\d.]+) msec, new height now: (\d+)"
)
RE_PROCESSED = re.compile(r"Processed height: (\d+)")
RE_DOWNLOADING = re.compile(r"Block height (\d+), downloading")
RE_UPTODATE = re.compile(r"Block height (\d+), up-to-date")
RE_FAIL = re.compile(r"Rewind-to-height failed: (.*)")
RE_COMPLETE = re.compile(r"Rewind complete at height (\d+)")


def _docker_bin() -> str:
    found = shutil.which("docker")
    if found:
        return found
    win = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    if os.path.isfile(win):
        return win
    return "docker"


def _run(argv: Sequence[str], timeout: float = 20.0) -> Tuple[int, str]:
    try:
        proc = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)
    text = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, text


def container_state(name: str) -> str:
    code, out = _run([_docker_bin(), "inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", name])
    if code != 0:
        return "absent"
    parts = out.strip().split()
    if not parts:
        return "absent"
    if parts[0] == "running":
        return "running"
    if len(parts) > 1 and parts[1] == "0":
        return "exited-ok"
    return "exited-fail"


def container_logs(name: str, tail: int) -> str:
    code, out = _run([_docker_bin(), "logs", "--tail", str(tail), name], timeout=30.0)
    if code != 0 and "No such" in out:
        return ""
    return out


def core_tip(cli: Optional[str], datadir: Optional[str]) -> Optional[int]:
    if not cli:
        return None
    argv = [cli]
    if datadir:
        argv.append("-datadir=" + datadir)
    argv.append("getblockcount")
    code, out = _run(argv, timeout=15.0)
    if code != 0:
        return None
    line = out.strip().splitlines()[-1] if out.strip() else ""
    if line.isdigit():
        return int(line)
    return None


def _last_int(matches: List[str]) -> Optional[int]:
    if not matches:
        return None
    return int(matches[-1])


def parse_logs(text: str) -> dict:
    tips = RE_TIP.findall(text) + RE_STORED.findall(text)
    undos = RE_UNDO.findall(text)
    return {
        "tip": _last_int(tips),
        "target": _last_int(RE_TARGET.findall(text)),
        "processed": _last_int(RE_PROCESSED.findall(text)),
        "downloading": _last_int(RE_DOWNLOADING.findall(text)),
        "uptodate": _last_int(RE_UPTODATE.findall(text)),
        "complete": _last_int(RE_COMPLETE.findall(text)),
        "fail": (RE_FAIL.findall(text) or [None])[-1],
        "undos": [(int(b), int(n), float(ms), int(now)) for b, n, ms, now in undos],
    }


def fmt_h(n: Optional[int]) -> str:
    if n is None:
        return "------"
    return f"{n:,}"


def fmt_eta(seconds: float) -> str:
    if seconds < 0 or seconds > 86400 * 14:
        return "unknown"
    seconds = int(seconds)
    hours, rem = divmod(seconds, 3600)
    minutes, _ = divmod(rem, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes}m"


def bar(pct: float, width: int = 52) -> str:
    pct = max(0.0, min(1.0, pct))
    filled = int(round(width * pct))
    return "[" + ("#" * filled) + ("." * (width - filled)) + "]"


def _line(text: str, width: int) -> str:
    body = " " + text
    if len(body) > width - 2:
        body = body[: width - 2]
    return "|" + body.ljust(width - 2) + "|"


def frame(lines: Sequence[str], width: int = 74) -> str:
    top = "+" + ("-" * (width - 2)) + "+"
    out = [top]
    for line in lines:
        out.append(_line(line, width))
    out.append(top)
    return "\n".join(out)


def snapshot(args: argparse.Namespace) -> str:
    rewind = container_state(args.rewind_container)
    forward = container_state(args.forward_container)
    rewind_logs = container_logs(args.rewind_container, args.tail) if rewind != "absent" else ""
    forward_logs = container_logs(args.forward_container, args.tail) if forward != "absent" else ""
    rw = parse_logs(rewind_logs)
    fw = parse_logs(forward_logs)
    fork = rw["target"] or FORK_HEIGHT
    origin = args.rewind_from
    core = core_tip(args.bitcoin_cli, args.datadir)

    if forward == "running" or (rewind == "exited-ok" and forward != "absent"):
        phase = "forward"
    elif rewind == "running":
        phase = "reverse"
    elif rewind == "exited-fail":
        phase = "stopped"
    elif fw["uptodate"] is not None and forward == "exited-ok":
        phase = "done"
    elif rewind == "exited-ok":
        phase = "handoff"
    else:
        phase = "idle"

    if phase == "forward":
        now = fw["processed"] or fw["uptodate"] or fork
        dest = core or fw["downloading"] or fw["uptodate"]
        source_h = fork
        direction = "FORWARD"
        source_name = "fork snapshot"
        dest_name = "Core chain tip"
        container = args.forward_container
        cstate = forward
        undos = []
    else:
        now = rw["tip"] if rw["tip"] is not None else rw["complete"]
        dest = fork
        source_h = origin
        if phase == "stopped":
            direction = "STOPPED"
        elif phase == "handoff":
            direction = "HANDOFF"
        elif phase == "done":
            direction = "DONE"
        elif phase == "idle":
            direction = "IDLE"
        else:
            direction = "REVERSE"
        source_name = "Knots Blake2b index"
        dest_name = "fork snapshot"
        container = args.rewind_container
        cstate = rewind
        undos = rw["undos"]

    span = None
    pct = 0.0
    done = left = None
    if source_h is not None and dest is not None and now is not None and source_h != dest:
        span = abs(dest - source_h)
        done = abs(now - source_h)
        left = abs(dest - now)
        pct = done / span if span else 0.0
        if phase == "reverse" and now <= dest:
            pct = 1.0
            left = 0
        if phase == "forward" and dest is not None and now >= dest:
            pct = 1.0
            left = 0

    rate = None
    if undos:
        sample = undos[-20:]
        rate = sum(ms for _b, _n, ms, _now in sample) / len(sample) / 1000.0
    eta = None
    if rate and left:
        eta = rate * left

    last = ""
    if undos:
        blk, ntx, ms, _now = undos[-1]
        last = f"last undo     block {fmt_h(blk)}   {ntx} tx   {ms / 1000.0:.1f}s"
    elif fw["uptodate"] is not None and phase in ("forward", "done"):
        last = f"last report   Core height {fmt_h(fw['uptodate'])} up-to-date"
    elif fw["processed"] is not None:
        last = f"last report   processed height {fmt_h(fw['processed'])} (every 1000 blocks)"
    elif rw["fail"]:
        last = "last error    " + str(rw["fail"])[:48]

    leg2_dest = fmt_h(core) if core is not None else "Core tip"
    lines = [
        "FULCRUM INDEX WALK",
        "",
        f"direction     {direction}",
        f"from          {source_name:<24} {fmt_h(source_h)}",
        f"now           {fmt_h(now)}",
        f"to            {dest_name:<24} {fmt_h(dest)}",
        "",
        f"{bar(pct)} {pct * 100:5.1f}%",
        _progress_line(done, left, rate, eta),
        "",
        f"leg 1         Knots {fmt_h(origin)} -> fork {fmt_h(fork)}"
        + ("   <-- active" if phase == "reverse" else ""),
        f"leg 2         fork {fmt_h(fork)} -> Core {leg2_dest}"
        + ("   <-- active" if phase == "forward" else ""),
        f"container     {container}  {cstate}",
    ]
    if last:
        lines.append(last)
    if phase == "handoff":
        lines.append("note          rewind exited clean; Core forward should start")
    if phase == "stopped" and rw["fail"] and "timed out" in str(rw["fail"]):
        lines.append("note          timeout; marker keeps the height, resume is safe")
    return frame(lines)


def _progress_line(
    done: Optional[int], left: Optional[int], rate: Optional[float], eta: Optional[float]
) -> str:
    parts = []
    if done is not None:
        parts.append(f"done {fmt_h(done)}")
    if left is not None:
        parts.append(f"left {fmt_h(left)}")
    if rate:
        parts.append(f"{rate:.1f} s/block")
    if eta is not None:
        parts.append("ETA " + fmt_eta(eta))
    return "   ".join(parts) if parts else "waiting for a height report"


HELP = """
--bitcoin-cli is a file path, not a function and not a Python callback.

It is bitcoin-cli.exe, the small program shipped next to bitcoind. This
monitor runs that program to ask Core how tall its chain is:

    bitcoin-cli -datadir DIR getblockcount

That height is the right-hand end of leg 2 (fork snapshot -> Core tip).
Skip the flag and leg 2 still draws; the destination just stays the words
"Core tip" instead of a number.

In PowerShell, quote the path. Do not wrap it in angle brackets. This fails:

    python scripts/fulcrum-walk-tui.py --bitcoin-cli <bitcoin-cli>

This works:

    python scripts/fulcrum-walk-tui.py --bitcoin-cli "E:\\tools\\bitcoin-cli.exe" --datadir E:\\Bitcoin

--rewind-from is the block height where the reverse walk started (the left
end of the bar). The default, 972680, is the Knots index tip when this
rewind began. Leave it unless that start height was different.
"""


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(
        description="ASCII monitor for the Fulcrum fork walk.",
        epilog=HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--once", action="store_true", help="Print one frame and exit")
    p.add_argument("--interval", type=float, default=2.0, metavar="SECS", help="Seconds between refreshes (default 2)")
    p.add_argument("--tail", type=int, default=400, metavar="N", help="How many Fulcrum log lines to read (default 400)")
    p.add_argument("--rewind-container", default="fulcrum-rewind", metavar="NAME", help="Docker container doing the reverse walk")
    p.add_argument("--forward-container", default="fulcrum-core-forward", metavar="NAME", help="Docker container doing the Core forward walk")
    p.add_argument(
        "--rewind-from",
        type=int,
        default=REWIND_FROM,
        metavar="HEIGHT",
        help="Height the reverse walk started from, left end of the bar (default %(default)s)",
    )
    p.add_argument(
        "--bitcoin-cli",
        default=None,
        metavar="EXE",
        help="Path to bitcoin-cli.exe (the Bitcoin Core RPC program). Optional. See below.",
    )
    p.add_argument(
        "--datadir",
        default=None,
        metavar="DIR",
        help="Core data directory passed to bitcoin-cli as -datadir (the folder with .cookie)",
    )
    args = p.parse_args(argv)

    if args.once or not sys.stdout.isatty():
        print(snapshot(args))
        return 0

    try:
        while True:
            sys.stdout.write("\x1b[2J\x1b[H")
            sys.stdout.write(snapshot(args))
            sys.stdout.write("\n  refresh %ss    Ctrl+C to quit\n" % args.interval)
            sys.stdout.flush()
            time.sleep(args.interval)
    except KeyboardInterrupt:
        sys.stdout.write("\n")
        return 0


if __name__ == "__main__":
    sys.exit(main())
