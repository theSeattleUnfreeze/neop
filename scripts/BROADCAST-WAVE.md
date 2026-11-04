# Same-wave broadcast

Broadcast the Core folder first. Broadcast the Knots folder only after every Core transaction has one confirmation. Dry-run is the default. `--send` talks to Bitcoin Core RPC, not to Electrum.

Copy [broadcast-wave.example.json](broadcast-wave.example.json) to `~/.neop/broadcast.json` and fill it in on this machine. That file is not committed. Do not put an onion address, an RPC password, or a cookie in the repo.

```text
node scripts/broadcast-wave.mjs --check
node scripts/broadcast-wave.mjs --core-dir PATH --knots-dir PATH
node scripts/broadcast-wave.mjs --send --core-dir PATH --knots-dir PATH
node scripts/broadcast-wave.mjs --send-knots --core-dir PATH --knots-dir PATH
```

`--send-knots` does not broadcast Core again. It waits until every Core transaction is in a block, then sends the Knots folder to the direct Knots RPC.

`--check` asks both RPCs for a block height and sends nothing. The folder command checks the files, asks Knots whether each Core input is still unspent, and runs `testmempoolaccept` on each chain. It prints filenames and counts. It does not send. `--send` does that same check, then sends Core, waits until each of those transactions is in a block, checks the Knots transactions again, and only then sends Knots.

Core RPC goes through the SOCKS proxy in the config. That proxy is not used for Knots. Knots RPC is a direct connection to `https://LAN-KNOTS:57747`, including when `socks` is set at the top of the config for the Core onion.

`--send-knots` sends the Knots folder only when every Knots input is already spent in a Core block. A replacement counts: the original txid does not have to be the transaction that spent it. An input that is still unspent on Core stops the send. Knots is still sent only to the direct Knots RPC. The script checks that spend again after the last Knots `testmempoolaccept`, and it does not broadcast Core.

## What is certain

These transactions are independent. Bitcoin has no call that accepts or rejects an unrelated set together. `submitpackage` is not used.

Nothing is sent unless every file passes locally, every Core input that is still unspent on Knots has an `OP_RETURN` script longer than 83 bytes, and `testmempoolaccept` allows every transaction on the node that will send it. One failure sends nothing.

A Core file with no such `OP_RETURN` is accepted only when Knots `gettxout` says every one of its inputs is already gone. A signed pre-garnish file, whose input is still unspent on Knots, fails that check. The whole folder stays unsent.

Knots files in this wave are `SIGHASH_ALL`. They can also confirm on Core until the matching Core transaction confirms. The script therefore sends them only after every Core transaction is in a block, and it runs `testmempoolaccept` on Knots a second time just before that send.

`testmempoolaccept` does not put a transaction in the mempool. Its fee ceiling is disabled (`maxfeerate` 0) because these fees were already chosen in the signed files. `sendrawtransaction` uses that same ceiling. The node still applies its own relay rules. Electrum broadcast is not a fallback.

Core and Knots must report the same genesis block, and both must be finished with initial block download. `gettxout` returning JSON null counts as spent only then. A missing result, or any result that is not an object, fails the check. A node that is still downloading blocks has not proved the spend. Nothing is sent.

Knots TLS checks the certificate unless `tlsInsecure` is true. An IP host does not send a TLS server name. The HTTP Host header brackets an IPv6 address.

The Core node must accept a datacarrier script of at least 120 bytes. Garnish scripts stay within that cap. If the node still has the 83-byte default, `testmempoolaccept` fails and nothing is sent.

## What is not certain

After the first Core `sendrawtransaction` succeeds, that transaction can propagate even if a later Core transaction fails. The script then does not send Knots. It cannot retract a Core transaction that the node already accepted.

A Core transaction can leave the mempool before it confirms, including when a replacement spends the same inputs. If that happens on two checks in a row, Knots is not sent. `--send` keeps waiting on the txid in each signed Core file. After the inputs are spent in a Core block, run `--send-knots`. That command does not broadcast Core again.

One confirmation is the gate the script waits for. Just before the Knots send, it checks again that every Knots input is gone from the Core chain. A reorg that puts an input back stops that send. A reorg after the Knots transaction is already accepted can still move a block.

The script prints filenames and accept or reject. It does not print scripts, addresses, raw transactions, txids, or RPC credentials.

## After the send

`scripts/watch-wave.mjs` watches a folder of signed PSBTs on the node that received them. It does not broadcast. For each transaction it shows the mempool entry, whether a different transaction now spends one of those inputs, and when the transaction is in a block. A block hash that changes at a height already seen is drawn as a reorg. Core uses the SOCKS proxy. Knots is the direct RPC.

```text
node scripts/watch-wave.mjs --dir FOLDER
node scripts/watch-wave.mjs --chain knots --dir FOLDER
```
