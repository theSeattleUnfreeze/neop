# Fulcrum fork walk — HDD pass

First measured reverse-then-forward walk of a Knots Fulcrum index down to the last common block, then forward on the Core chain. This pass is the **spinning platter / HDD** run. A later pass can reuse the same table with different media.

Drive model, interface, and capacity are not filled in yet.

## Storage

| | |
|--|--|
| Media | Spinning platter (HDD) |
| Model | |
| Interface | |
| Capacity | |
| What was timed | The Fulcrum index datadir. Not the Core block archive. |

The Knots index copy was about **191 GB** when the walk started.

## Chain heights

| | Height |
|--|--|
| Last common block (rewind target) | **961,631** |
| First block that is not shared | 961,632 |
| Knots index tip at the start of the reverse walk | **972,680** (first block undone) |
| Index height when the first container stopped | **970,264** |
| Core chain tip at the snapshot below | **967,812** |
| Core chain tip when the forward leg caught up | **969,137** |

Forward span, once the reverse walk reaches 961,631, is whatever the Core tip is then minus 961,631. At the snapshot that would have been 6,181 blocks (967,812 − 961,631), and it grows while Core is still syncing. The actual forward span was 7,506 blocks (969,137 − 961,631).

## Status

Both legs are done. The reverse leg finished at **961,631** on 2026-09-28 22:11:52 UTC. The Core forward leg started at 22:12:22 UTC and reported up-to-date at **969,137** on 2026-09-29 09:55:35 UTC. Fulcrum was left running and following the Core tip.

The host crashed while the resume container was undoing. Last logged tip before the crash: **962,926** (2026-09-20 11:23:35 UTC). After reboot, Docker was restarted, the Knots RPC tunnel was restored, and the walk resumed from the `rewind_target` marker. First undo after that resume: **962,925 → 962,924** (2026-09-21 17:02:47 UTC).

That container reached **962,299** at 2026-09-21 21:01:19 UTC, then paused when the Knots node stopped answering. On 2026-09-22 06:20:56 UTC it was stopped by a signal and exited 0. The handoff took that exit code as success and started the Core forward on the half-rewound index. The Core forward never reached a node, so it indexed nothing. It was stopped on 2026-09-28, and the handoff now also requires Fulcrum's completion line before it starts the forward leg.

## Clock

Times below are UTC. The machine's local offset that day was −04:00.

| Event | Time | Index height |
|--|--|--|
| Reverse walk start height (first block undone) | not retained to the minute; the container was already running when handoff began waiting at 2026-09-18 17:59:20 | **972,680** |
| First container exit (RPC timeout) | 2026-09-18 21:10:47 | not retained |
| First container restarted | 2026-09-18 21:29:03 | |
| First container exit (Knots RPC link dropped) | 2026-09-18 22:27:12 | **970,264** |
| Resume container started | 2026-09-19 23:16:03 | 970,264 |
| First undo after resume | 2026-09-19 23:16:42 | 970,264 → 970,263 |
| Snapshot | 2026-09-20 08:56:28 | **963,285** |
| Last undo before host crash | 2026-09-20 11:23:35 | **962,926** |
| Post-crash resume started | 2026-09-21 17:01:41 | 962,926 |
| First undo after post-crash resume | 2026-09-21 17:02:47 | 962,925 → 962,924 |
| Last undo before the Knots node dropped | 2026-09-21 21:01:19 | **962,299** |
| Container stopped by signal | 2026-09-22 06:20:56 | 962,299 |
| Final resume started | 2026-09-28 17:43:20 | 962,299 |
| First undo after final resume | 2026-09-28 17:44:28 | 962,299 → 962,298 |
| Reverse walk finished | 2026-09-28 22:11:52 | **961,631** |
| Core forward started | 2026-09-28 22:12:22 | 961,631 |
| Core forward: first sync line | 2026-09-29 05:12:11 | 961,631 |
| Core forward finished | 2026-09-29 09:55:35 | **969,137** (Core tip) |

The gap from 2026-09-18 22:27:12 to 2026-09-19 23:16:03 is downtime (the Knots RPC tunnel was down). So is 2026-09-21 21:01:19 to 2026-09-28 17:43:20 (the Knots host was down or freezing, then the walk waited). So is 2026-09-28 22:12:36 to 2026-09-29 05:12:11 (the forward leg waited for a Core node). None of it is index work.

## Resume container (log still on disk)

Fulcrum 2.1.2, `--rewind-to-height 961631`, undo synthesized from `getblock` verbosity 3. At open, before the first undo of this process: 1,416,061,072 transactions, 166,642,351 UTXOs (about 14.0 GB). `db_mem` 1024 MiB.

From the first undo (970,264 at 23:16:42 UTC) through the sample that closed at 08:55:20 UTC (tip 963,287):

| | |
|--|--|
| Wall time | 9.64 h |
| Time inside undo apply | 5.56 h |
| Undo samples | 6,806 |
| Mean | 2.94 s/block |
| Median | 1.08 s/block |
| 90th percentile | 8.66 s/block |
| Slowest sample | 36.1 s |

Two RPC timeouts, each about 10 minutes, then the same height was retried. No rewind was abandoned.

| Paused | Height | Gap until the next undo |
|--|--|--|
| 2026-09-20 00:25:42 | 969,910 | 10.4 min |
| 2026-09-20 02:41:41 | 967,867 | 10.4 min |

The first container had already consumed the stored undo (100 blocks, the default `max_reorg`). Every undo in this log is synthesized. That container's per-block lines are gone; the heights and exit times above are from the handoff record and from this process undoing 970,264 first.

The post-crash container's per-block log (962,926 to 962,299) was removed when the final resume replaced it. Only the heights and times above remain.

## Final resume container (log still on disk)

From the first undo (962,299 at 17:44:28 UTC) to the completion line (961,631 at 22:11:52 UTC):

| | |
|--|--|
| Wall time | 4.46 h |
| Time inside undo apply | 2.52 h |
| Undo samples | 668 |
| Mean | 13.57 s/block |
| Median | 13.27 s/block |
| 90th percentile | 16.05 s/block |
| Slowest sample | 47.2 s |

No pauses or retries. Blocks here were slower than in the first resume container (mean 2.94 s). This leg started with a cold cache after a week idle, and the Knots host was under swap pressure; this log does not separate the two.

Completion line: `Rewind complete at height 961631 hash 00000000000000000000807f9dc917442a67910426d79ebb2f8aa2149327ce8a utxo_count=165777423 txNumNext=1413738446`.

## Core forward leg (log still on disk)

Fulcrum 2.1.2 on the rewound index, synced from a Core node over RPC. `db_mem` 1024 MiB. At open (22:12:36 UTC): 1,413,738,446 transactions, 165,777,423 UTXOs (13,925 MB). Those match the rewind completion line.

The Core node on the same machine had not run since the 2026-09-20 host crash, so the container waited about 7.0 h (22:12:36 to 05:12:11 UTC). The node first answered, still warming up, at 05:01:40 UTC. It was behind its tip and caught up on the same machine and disk while Fulcrum synced. It reported synced at about 08:49 UTC.

From the first sync line (05:12:11 UTC) to up-to-date (09:55:35 UTC), blocks 961,632 through 969,137:

| | |
|--|--|
| Wall time | 4.72 h |
| Blocks | 7,506 |
| Transactions | 35,526,064 |
| Mean | 26.5 blocks/min |
| While the Core node was catching up (961,632 → 964,000, 05:12:11 to 08:49:15) | 2,369 blocks in 3.62 h, 10.9 blocks/min |
| After the Core node caught up (964,000 → 969,137, 08:49:15 to 09:55:35) | 5,137 blocks in 1.11 h, 1.29 blocks/s |

Fulcrum's own 1,000-block samples:

| Height | Time | Rate |
|--|--|--|
| 962,000 | 05:36:10 | 15.4 blocks/min |
| 963,000 | 07:08:46 | 10.8 blocks/min |
| 964,000 | 08:49:14 | 9.95 blocks/min |
| 965,000 | 09:00:35 | 1.47 blocks/s |
| 966,000 | 09:14:18 | 1.21 blocks/s |
| 967,000 | 09:27:03 | 1.31 blocks/s |
| 968,000 | 09:40:55 | 51.8 blocks/min (includes the batch restart below) |
| 969,000 | 09:54:05 | 1.26 blocks/s |

Fulcrum synced in three batches, each ending at the tip it saw when the batch began:

| Batch | Ended | Blocks | Transactions |
|--|--|--|--|
| 961,632 → 967,818 | 09:37:24 | 6,187 | 29,329,713 |
| 967,819 → 969,134 | 09:55:34 | 1,316 | 6,179,958 |
| 969,135 → 969,137 | 09:55:35 | 3 | 16,393 |

All three logged `verified ok`. No restarts, pauses, or errors during sync. Transaction count at the tip, from the open count plus the batch totals: 1,449,264,510. Fulcrum does not log the UTXO count after sync.

Completion line: `Block height 969137, up-to-date`. It followed the next block (969,138) at 09:57:35 UTC.
