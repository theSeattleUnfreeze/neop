# Fulcrum round trip across the fork (issue #29)

Second fork walk, run the other way. The first walk ([fulcrum-fork-walk-hdd.md](fulcrum-fork-walk-hdd.md)) rewound a Knots index to the last common block and forward-synced it on Core. This one rewinds a copy of that **Core** index back to the split against Core, forward-syncs it on **Knots**, and compares the result with an index that never left Knots.

If the two Knots indexes match at the same tip, a Fulcrum index can cross the fork in both directions without a fresh sync.

| | Height |
|--|--|
| Last common block | 961,631 |
| First divergent block | 961,632 |
| Core tip when the copy was taken | 969,515 |

## Setup

| Piece | Where |
|--|--|
| Round-trip index | NVMe SSD (Samsung 970 EVO 1 TB), Docker Desktop bind mount on Windows |
| Core node (bitcoind 28.3) | Local, SMR HDD (Seagate ST4000DM004) |
| Knots node | StartOS on the LAN (`STARTOS_HOST`), reached through an SSH `-L` tunnel and a loopback auth proxy |
| Fulcrum | privkeyio Fulcrum v2.1.2-blake-3 plus local `--rewind-to-height` patches (not upstreamed) |

The Knots RPC path is: Fulcrum container → `host.docker.internal:15081` → SSH tunnel → `127.0.0.1:15081` on StartOS → [`scripts/startos-rpc-auth-proxy.py`](../../scripts/startos-rpc-auth-proxy.py) → Knots RPC. The proxy injects the node cookie on StartOS, so no RPC secret is stored on the Windows host.

## Timeline

| When (UTC) | Event |
|--|--|
| 2026-10-02 02:39 | Copied the 193.8 GB Core index (51 min). Rewind against Core started. |
| 2026-10-02 03:02 | The rewind was too slow on the SMR HDD, so the copies swapped roles. The HDD copy serves Core; the round trip moved to the NVMe copy. |
| 2026-10-02 21:41 – 22:42 | Instrumented the rewind, then three optimization builds swapped in, each with a clean stop and a resume from the rewind marker (see below). |
| 2026-10-04 12:47 | **Rewind complete at 961,631** (`utxo_count=165777423`, `txNumNext=1413738446`). It paused 18 times when Core RPC dropped and resumed each time. |
| 2026-10-04 12:47 | Knots forward leg started automatically (`roundtrip.ps1`). |
| 2026-10-04 – 10-06 | Forward leg crawled about 1,000 blocks a day (see the proxy pipelining incident). |
| 2026-10-06 ~16:30 | SSH tunnel died; the forward leg waited for bitcoind at about 963,557. |
| 2026-10-09 05:51 | StartOS rebooted, which wiped the proxy from `/tmp`. |
| 2026-10-11 05:50 | Tunnel and old proxy restarted by hand; still slow, with 10-minute `getblock` timeouts. |
| 2026-10-12 06:03 | Fixed proxy deployed by the new link watchdog. Forward leg went to 9–45 blocks/s. |

## Rewind performance

Per block, the rewind started about 18× slower than forward sync (about 46–52 s vs 2.6 s per block). Forward sync appends scripthash history with a RocksDB merge (a blind write). Undo has to read each scripthash's history, filter it and write it back, and synthesized undo also looks up the earlier transaction for every spent input. Every one of those reads was serial.

The disk was not the limit. The NVMe sat around 265 reads/s at under a millisecond, and the container used about one of eight cores. Each lookup still took about 3 ms through the Docker Desktop bind mount (Linux VM → Windows file sharing).

Per-block breakdown before the changes (13 blocks):

| Step | Time per block | Share |
|--|--|--|
| Scripthash history read-modify-write (~10k serial gets) | ~28 s | 57% |
| `txhash2txnum` lookups for spent inputs (~6k serial finds) | ~18 s | 35% |
| `getblock` verbosity 3 from Core | ~1.7 s | 3% |
| Batch write + `SyncWAL` | ~2.3 s | 5% |

Changes, measured one at a time:

| Change | Effect |
|--|--|
| Parallel `txhash2txnum` finds (32 threads) | 18 s → 2–7 s per block |
| Parallel scripthash history reads | 28 s → ~14 s, but exposed the next serial step |
| Chunked parallel `MultiGet` in the `txhash2txnum` truncation | Removed a ~10 s wait that had been hidden behind the serial loop |
| `db_mem` 1024 → 8192 | More lookups served from the block cache |
| Prefetch the next block's `getblock` while applying the current one | Fetch fully off the critical path |

Result: about 23–27 s per block averaged over mixed blocks, about 2× the original. Adding threads stopped helping at roughly 700–1,000 reads/s for the whole process, which points at Docker Desktop file sharing. A native Windows Fulcrum build is the remaining large step.

## Incidents and hardening

### Auth proxy dropped pipelined requests

Fulcrum pipelines several HTTP requests on each RPC connection. The first proxy read up to 64 KB per `recv`, kept only the first request's body, and discarded the rest of the buffer. Any request that arrived in the same read as an earlier one was lost, and Fulcrum waited 10 minutes (`bitcoind_timeout=600`) before giving up. Simple probes such as `getblockcount` still worked, which hid the bug.

Fix: [`scripts/startos-rpc-auth-proxy.py`](../../scripts/startos-rpc-auth-proxy.py) keeps a read buffer per side and carries extra bytes into the next message. It also re-reads the cookie for every connection, so a node restart no longer needs a proxy restart. Tests: `tests/test_startos_rpc_auth_proxy.py`, which covers pipelined requests, cookie injection and bodies split across reads.

Effect on the forward leg: about 1,000 blocks a day before, 9–45 blocks/s after.

### Tunnel death and StartOS reboot

A plain `while ($true) { ssh -L … }` loop died with no record, and a StartOS reboot wiped the proxy from `/tmp`. Fulcrum waited for days.

Fix: [`scripts/startos-knots-link.ps1`](../../scripts/startos-knots-link.ps1), a watchdog that:

- holds the SSH tunnel and restarts it when it exits;
- probes `getblockcount` through the tunnel every 30 s on a fresh connection, with a 60 s timeout, counts HTTP 503 (node work queue full) as alive, and logs only state changes with the failure reason;
- after four failed probes in a row, checks the far end and redeploys the proxy if it isn't listening, its script hash is stale, or it is listening but not answering;
- at startup, replaces a deployed proxy whose hash differs from the repo copy, because a stale proxy can still pass simple probes.

Lessons from writing it:
- In a hidden window, `ssh` without `-n` waits on stdin forever.
- PowerShell reuses keep-alive connections, and the node closes idle ones after about 30 s. With a 30 s probe interval, every other probe hit a dead pooled socket and the link looked like it was flapping. Probes now use `-DisableKeepAlive`.
- `pkill -f` needs an anchored pattern (`^python3 /tmp/rpc-auth-proxy.py`). Otherwise it also matches, and kills, the remote shell whose command line contains the same string.

### Windows restarts

Containers use `--restart unless-stopped`, but nothing brought back Docker Desktop, the Core node or the tunnel after a reboot. A per-user logon task now starts each of them if it is missing (local operator script, not in the repo).

### Rewind interruptions

`--rewind-to-height` keeps a `rewind_target` marker, so the same datadir resumes where it stopped. When the Core RPC connection drops, the rewind pauses and resumes on the next good connection, which happened 18 times on this run. Other failures exit with restart instructions. A `docker stop` exits 0, so the orchestrator checks for the completion line, not the exit code.

## Remaining steps

1. Forward leg reaches the Knots tip.
2. Freeze a baseline: stop the StartOS Fulcrum package, record its tip, copy its datadir with [`scripts/neop-rsync`](../../scripts/neop-rsync), and start it again.
3. Stop the round-trip index at the baseline tip. If it overshot, rewind it there with stored undo.
4. Compare the two indexes offline (per column family digest), then record the result here.
