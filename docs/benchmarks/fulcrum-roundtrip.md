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

The Knots RPC path is: Fulcrum container â†’ `host.docker.internal:15081` â†’ SSH tunnel â†’ `127.0.0.1:15081` on StartOS â†’ [`scripts/startos-rpc-auth-proxy.py`](../../scripts/startos-rpc-auth-proxy.py) â†’ Knots RPC. The proxy injects the node cookie on StartOS, so no RPC secret is stored on the Windows host.

## Timeline

| When (UTC) | Event |
|--|--|
| 2026-10-02 02:39 | Copied the 193.8 GB Core index (51 min). Rewind against Core started. |
| 2026-10-02 03:02 | The rewind was too slow on the SMR HDD, so the copies swapped roles. The HDD copy serves Core; the round trip moved to the NVMe copy. |
| 2026-10-02 21:41 â€“ 22:42 | Instrumented the rewind, then three optimization builds swapped in, each with a clean stop and a resume from the rewind marker (see below). |
| 2026-10-04 12:47 | **Rewind complete at 961,631** (`utxo_count=165777423`, `txNumNext=1413738446`). It paused 18 times when Core RPC dropped and resumed each time. |
| 2026-10-04 12:47 | Knots forward leg started automatically (`roundtrip.ps1`). |
| 2026-10-04 â€“ 10-06 | Forward leg crawled about 1,000 blocks a day (see the proxy pipelining incident). |
| 2026-10-06 ~16:30 | SSH tunnel died; the forward leg waited for bitcoind at about 963,557. |
| 2026-10-09 05:51 | StartOS rebooted, which wiped the proxy from `/tmp`. |
| 2026-10-11 05:50 | Tunnel and old proxy restarted by hand; still slow, with 10-minute `getblock` timeouts. |
| 2026-10-12 06:03 | Fixed proxy deployed by the new link watchdog. Forward leg went to 9â€“45 blocks/s. |
| 2026-10-12 06:33 | Forward leg reached the Knots tip and followed it from then on. |
| 2026-10-14 23:15 | Knots on StartOS shut down cleanly (cause unknown, not this run). Both indexes stopped at 977,262. |
| 2026-10-15 00:15 | Baseline freeze started; round-trip index stopped. |
| 2026-10-15 00:35 | Restarting Knots while the baseline copy was reading the same disk wedged StartOS for about an hour. The copy failed at 7%, and the copy script's cleanup restarted StartOS Fulcrum. |
| 2026-10-15 02:10 | Baseline copy restarted with a bandwidth cap. StartOS Fulcrum had advanced, so the round trip will forward to the new baseline tip before the comparison. |
| 2026-10-15 02:57 | StartOS restarted its Fulcrum package mid-copy (cause unknown), so that copy was torn (`rsync` code 24). |
| 2026-10-15 07:14 | Second copy pass with Fulcrum stopped and a guard that aborts if it starts: 72 MB changed, `rc=0`. **Baseline frozen at 977,320.** |
| 2026-10-15 07:22 | Round trip forwarded to 977,321, then rewound one block with stored undo to 977,320. |
| 2026-10-15 ~11:25 | Both digests finished. **Round trip matches the baseline** (see below). |

## Rewind performance

Per block, the rewind started about 18Ã— slower than forward sync (about 46â€“52 s vs 2.6 s per block). Forward sync appends scripthash history with a RocksDB merge (a blind write). Undo has to read each scripthash's history, filter it and write it back, and synthesized undo also looks up the earlier transaction for every spent input. Every one of those reads was serial.

The disk was not the limit. The NVMe sat around 265 reads/s at under a millisecond, and the container used about one of eight cores. Each lookup still took about 3 ms through the Docker Desktop bind mount (Linux VM â†’ Windows file sharing).

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
| Parallel `txhash2txnum` finds (32 threads) | 18 s â†’ 2â€“7 s per block |
| Parallel scripthash history reads | 28 s â†’ ~14 s, but exposed the next serial step |
| Chunked parallel `MultiGet` in the `txhash2txnum` truncation | Removed a ~10 s wait that had been hidden behind the serial loop |
| `db_mem` 1024 â†’ 8192 | More lookups served from the block cache |
| Prefetch the next block's `getblock` while applying the current one | Fetch fully off the critical path |

Result: about 23â€“27 s per block averaged over mixed blocks, about 2Ã— the original. Adding threads stopped helping at roughly 700â€“1,000 reads/s for the whole process, which points at Docker Desktop file sharing. A native Windows Fulcrum build is the remaining large step.

## Incidents and hardening

### Auth proxy dropped pipelined requests

Fulcrum pipelines several HTTP requests on each RPC connection. The first proxy read up to 64 KB per `recv`, kept only the first request's body, and discarded the rest of the buffer. Any request that arrived in the same read as an earlier one was lost, and Fulcrum waited 10 minutes (`bitcoind_timeout=600`) before giving up. Simple probes such as `getblockcount` still worked, which hid the bug.

Fix: [`scripts/startos-rpc-auth-proxy.py`](../../scripts/startos-rpc-auth-proxy.py) keeps a read buffer per side and carries extra bytes into the next message. It also re-reads the cookie for every connection, so a node restart no longer needs a proxy restart. Tests: `tests/test_startos_rpc_auth_proxy.py`, which covers pipelined requests, cookie injection and bodies split across reads.

Effect on the forward leg: about 1,000 blocks a day before, 9â€“45 blocks/s after.

### Tunnel death and StartOS reboot

A plain `while ($true) { ssh -L â€¦ }` loop died with no record, and a StartOS reboot wiped the proxy from `/tmp`. Fulcrum waited for days.

Fix: [`scripts/startos-knots-link.ps1`](../../scripts/startos-knots-link.ps1), a watchdog that:

- holds the SSH tunnel and restarts it when it exits;
- probes `getblockcount` through the tunnel every 30 s on a fresh connection, with a 60 s timeout, counts HTTP 503 (node work queue full) as alive, and logs only state changes with the failure reason;
- after four failed probes in a row, checks the far end and redeploys the proxy if it isn't listening, its script hash is stale, or it is listening but not answering;
- at startup, replaces a deployed proxy whose hash differs from the repo copy, because a stale proxy can still pass simple probes.

Lessons from writing it:
- In a hidden window, `ssh` without `-n` waits on stdin forever.
- PowerShell reuses keep-alive connections, and the node closes idle ones after about 30 s. With a 30 s probe interval, every other probe hit a dead pooled socket and the link looked like it was flapping. Probes now use `-DisableKeepAlive`.
- `pkill -f` needs an anchored pattern (`^python3 /tmp/rpc-auth-proxy.py`). Otherwise it also matches, and kills, the remote shell whose command line contains the same string.
- A wedged StartOS can accept the SSH login but never run the command. `ConnectTimeout` and `ServerAlive` don't catch that, and the watchdog hung for 1.5 hours on one call. Remote `ssh` and `scp` calls now have a wall-clock limit (`-RemoteTimeoutSeconds`, default 120).

### StartOS wedged under concurrent I/O

Knots startup while `rsync` read the 200 GB Fulcrum database from the same disk left StartOS answering pings and its web UI, but unable to start new processes, for about an hour. No reboot was needed. The baseline copy now runs with `--delete --bwlimit=10m` and should not overlap a Knots start.

### Windows restarts

Containers use `--restart unless-stopped`, but nothing brought back Docker Desktop, the Core node or the tunnel after a reboot. A per-user logon task now starts each of them if it is missing (local operator script, not in the repo).

### Rewind interruptions

`--rewind-to-height` keeps a `rewind_target` marker, so the same datadir resumes where it stopped. When the Core RPC connection drops, the rewind pauses and resumes on the next good connection, which happened 18 times on this run. Other failures exit with restart instructions. A `docker stop` exits 0, so the orchestrator checks for the completion line, not the exit code.

## Result

Both indexes at 977,320 (hash `0000000000000000c0a07afd7fd1fddeb4640361b9b367e4d7e91921986078f7`, `utxo_count=167236712`, `txNumNext=1417511854`). Digest = row count plus SHA-256 over every key and value of each column family in key order, from one RocksDB snapshot (local Fulcrum `--db-digest`, not upstreamed).

| Column family | Rows | Match |
|--|--|--|
| `blkinfo` | 977,321 | identical |
| `headers` | 122,167 | identical |
| `meta` | 3 | identical |
| `scripthash_history` | 1,541,118,272 (84.4 GB) | identical |
| `scripthash_unspent` | 167,236,712 | identical |
| `txhash2txnum` | 1,417,508,344 | identical |
| `txnum2txhash` | 88,594,492 | identical |
| `utxoset` | 167,236,710 | identical |
| `undo` | 99 vs 100 | differs, expected: each index kept the undo of its own recent blocks |
| `headers_v2` | 15,682 vs 15,681 | differs by one leftover row, explained below |

So a Core index rewound to the split and forward-synced on Knots is the same index as one that synced Knots straight through. Every table a client query reads is byte-for-byte identical.

`headers_v2` holds the 84-byte tail of each Blake2b header, keyed by height. Undoing a block truncates `headers` but does not delete the tail, so the one-block rewind from 977,321 left that tail behind. It is never read, because a tail is only looked up for a header record marked as extended, and there is none past the tip. The next block at that height overwrites it. The same leftover follows any ordinary reorg in privkeyio Fulcrum; it is untidy but not a correctness problem.

`utxoset` has two fewer rows than `scripthash_unspent` in both indexes, which is consistent with the two historic duplicate coinbase transactions (BIP 30).

Digest time on this hardware: about 3.6 h on the NVMe copy and 4.2 h on the SMR HDD, mostly `scripthash_history` and `txnum2txhash`.
