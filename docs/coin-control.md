# Coin control — splits, multisig, and affected Coldcard seeds

Normative notes for operators and for coding agents assisting a conversation. Scoop shows the catalog. It does not sign, and it does not choose the destination.

Wallet material stays on the machine. Do not ask for, print, or transmit seeds, xprvs, xpubs, descriptors, addresses, fingerprints, or wallet files. A format check may say whether a public key was found. Electrum URLs stay on the operator's own Fulcrum and Shulcrum. See [scoop.md](scoop.md).

## What to tell them apart

| Thing | What it is | What it is not |
|-------|------------|----------------|
| **Outpoint** | One coin: `txid:vout` on a tip | An address |
| **Address** | One script. It can hold many outpoints | A replay boundary |
| **Policy** | The keys and threshold that can spend the script (a single key, or a multisig of cosigners) | One UTXO |
| **Presence** | Which tips have this outpoint in view: unspent, or spent when the other tip still holds it (`core_only`, `knots_only`, `both`) | A property of the address. `both` is not by itself replay risk |
| **Replay risk** | That same outpoint is unspent on Core and on Knots, so a transaction that spends only such inputs can confirm on both tips | "This address has coins on both chains" |

An address is **mixed** when its outpoints are not all the same presence. Some may be `both`, some `knots_only`, some `core_only`. Show that. Do not call the address replay-exposed. Spending a `knots_only` outpoint cannot confirm on Core. Spending a `core_only` outpoint cannot confirm on Knots. Only a spend made entirely of `both` outpoints can be replayed.

Several outpoints per address is normal. Gap limit is how far along the receive chain discovery looks. It does not mean one UTXO per address. Eighty percent of the value sitting on twenty percent of the addresses is still one row per outpoint, grouped under the address.

Catalog labels are trustworthy only when **both** indexers answered. If one Fulcrum timed out, say the row is unconfirmed. Do not invent `knots_only` from a Knots hit alone.

## Splitting pre-fork coins

A `both` outpoint was created before the chains diverged (or the same payment landed on both). A normal spend of only those inputs is valid on both tips. PoW does not stop the replay. See [replay.md](replay.md).

Lasting bind is **taint / unique-input**: at least one input exists only on the chain you are spending. Preferred order is Knots first.

1. Build both waves before either is broadcast.
2. **Knots wave.** Every Knots-live outpoint you intend to exit: the `both` coins **and** the `knots_only` coins, paying a **new** policy. One `knots_only` input is enough to make a transaction invalid on Core. Broadcast only on Knots.
3. The Core twins do not move with that transaction. They sit on the same scripts until a Core spend.
4. **Core wave.** Every Core-live outpoint, paying a new Core policy. Broadcast it once it cannot replay onto Knots. That is after the Knots wave confirms, or sooner if the Core transaction is itself invalid on Knots.
5. This wallet is empty of the old policy on a chain only after that chain's wave confirms. Calling the wallet "Knots only" before the Core wave hides the twins.

Do not mix in a post-fork exchange deposit. That input is `core_only` and ties the pre-fork coins to the exchange. A `knots_only` coin already in the same wallet is the taint that does not import a new identity.

A plain send of the `both` outpoints, with no Knots-only input and no other wedge, does not split them. If it is replayed, the destination receives `both` coins.

Knots-first sighash ([replay.md](replay.md), Knots [#357](https://github.com/bitcoinknots/bitcoin/pull/357)) is the other lasting Knots bind. It is not required when a `knots_only` input is available. An `OP_RETURN` whose scriptPubKey is larger than 83 bytes is temporary Core garnish while reduced-data rules hold, through **2027-09-01**. It is how a Core wave can be in flight before the Knots wave confirms, when there is no acceptable `core_only` input. It is not the lasting bind, and it is not a way to retire the coins by itself.

Scoop does not choose the inputs, the destinations, or the signatures. For a same-wave split of `both` coins when there is no Knots-only input to mix in, build two families and sign every one before broadcasting any:

- **Knots.** In Shrike, one transaction per outpoint, unified sighash on ([#357](https://github.com/bitcoinknots/bitcoin/pull/357)). That transaction is invalid on Core. Do not send these files through Scoop.
- **Core.** In Sparrow, one unsigned PSBT per outpoint, one payment output, a fresh address of the new policy. Drop those files on Scoop’s Garnish page. Scoop adds a random `OP_RETURN` whose scriptPubKey is longer than 83 bytes and takes the extra fee from that single payment. Then the Coldcards sign. Broadcast only on Core.

A signature commits to the outputs. Scoop refuses a PSBT that is already signed, and it refuses a PSBT with more than one input. The garnish is temporary: it works while Knots still rejects an `OP_RETURN` script longer than 83 bytes, through **2027-09-01**. Core itself must accept that output. Bitcoin Core 28’s default datacarrier limit is 83 bytes, so the Core node needs a higher `datacarriersize` before it will relay the transaction. The scriptPubKey stays within 84 to 120 bytes. Across one drop, Scoop rotates raw bytes, a text memo, hex text, and an OP_RETURN of several pushes. There is no shared string. Set Core `datacarriersize` to at least 120 before relay. Bitcoin Core 28’s default limit is 83.

When both families are signed, [scripts/BROADCAST-WAVE.md](../scripts/BROADCAST-WAVE.md) sends Core first and sends Knots only after every Core transaction has a confirmation. A Core file without the long `OP_RETURN` is allowed only when its inputs are already gone from Knots. One failed check sends nothing.

## One wave, and the privacy cost

Loss prevention and chain privacy pull apart the moment a script is going to be spent.

- **Loss prevention.** Sign every live outpoint of the policy on that chain **before** the first one is broadcast. Release the whole set in one wave. Pay a new policy. Leave no change on the old keys. One address is not the boundary: a recovered master key derives the other addresses.
- **One transaction** that spends every outpoint starves a watcher, and it proves those coins share an owner (common-input ownership).
- **Several transactions released together** also cover the chain, without a single common-input proof. They still cluster by timing. They cluster for certain if they pay the same destination address. Fresh addresses of the new policy, one per chunk, are what keep the chunks from pointing at one output.
- **Spacing those chunks across blocks** is the privacy pattern, and it is the theft window. The first spend publishes the script as soon as it reaches the mempool, not when it confirms. Everything you held back for a later block is still on the old policy.

A watcher who recovers the seeds learns the whole cluster either way. The consolidation fingerprint is what remains for everyone who never recovers a key and only reads the chain.

Both chains cannot be one wave. A Knots transaction that includes a Knots-only input will not confirm on Core. Prepare the Core wave first. An unconfirmed wave can still be replaced by a conflicting spend if the keys fall before it confirms. Confirmation is what finishes the exit.

Paying the new coins back into **this same policy** splits the fork and leaves the entropy problem where it was.

## Affected Coldcard multisig

Public write-ups, not a neop measurement:

- [Coinkite, technical backgrounder](https://blog.coinkite.com/entropy-technical-backgrounder/) — affected Mk4 / Q / Mk5 seeds are estimated near a 72-bit search space, against a 128-bit design target. Mk3 seeds from the affected firmware were far smaller.
- [Block, predictable RNG fallback](https://engineering.block.xyz/blog/predictable-rng-fallback-and-32-bit-reseed-in-coldcard-firmware) — a quorum made only of affected Coldcards does not contain the bug. A threshold that can be met with those devices alone stays exposed.
- [Coinkite advisory](https://blog.coinkite.com/coldcard-mk3-seed-generation-warning/) and [migration notes](https://coldcard.com/security/migrate) — installing fixed firmware does not repair a seed already generated. Enough private dice, or a strong unique passphrase, can put a seed outside the weak space those notes describe. Do not ask the operator to type either secret. State the condition and let them decide.

Neop does not restate a search procedure and does not adopt a private estimate of how fast that space falls.

A native-segwit or wrapped multisig output is a **hash** until it is spent. While no spend of that script exists on either chain, someone walking a weak seed space still has to find the combination that hashes to the output. That is the protection of an unpublished descriptor. One cosigner xpub is not that descriptor. Scoop says so when it sees a multisig Sparrow file: it can watch one cosigner, which is not the script.

The first spend puts the whole witness script on the chain that sees it: every cosigner public key in that script, plus the signatures. A normal signature does not reveal a private key. The disclosure is the public keys.

What changes after that:

- Each affected seed can be checked on its own against the published key. The combination shield for that script is gone. For a 2-of-3, two recovered seeds meet the threshold.
- Recovering the seeds recovers the master keys. Standard multisig derivation then reaches every other address in the policy, including change, and both chains. Sibling addresses are not computable from the published child keys alone. They become reachable once the seeds are known. Coins that never moved are not spared.
- Other UTXOs on the **same** address share that script. The spend publishes it for all of them at once.
- A Knots-only broadcast is enough. The witness does not have to confirm on Core. Keys recovered from it spend the Core twins of that script, and any other output the recovered seeds can derive. Replay protection does not wall this off.

The balance, for a pre-fork balance that is still sitting in a single-vendor affected Coldcard multisig:

- Leaving a script unspent keeps it hashed. That preserves the unpublished-descriptor assumption for every coin on that script, on both chains.
- Splitting by paying an address of **this same policy** publishes the spent script and leaves the new coins under the same keys.
- Splitting by paying a **new** policy is the migration. The new policy should not be satisfiable by these Coldcards alone. The first spend should already have every other live outpoint of the old policy on that chain signed and in the mempool. A partial spend publishes the keys and leaves the rest to be taken. The other chain is a second wave, built first.

## What Scoop shows

- One row per outpoint (`txid:vout`), grouped under the address.
- Presence and the replay flag are on the outpoint. A mixed group is labeled mixed and is not a replay flag.
- **Needs split** selects replay-risk rows (the same outpoint unspent on both tips). A Core-bound row can still have presence `both` because Core has spent it; the flag is core-bound, and the checklist counts those separately.
- Per script, after a sync: **witness still hashed**, **witness published** (some transaction on either tip is not just a current funding output), or **unknown** when an indexer did not answer. That flag is not "safe to spend."
- The split checklist states the one-wave exit, the common-input cost, and that a multisig spend publishes the cosigner keys. Scoop still does not sign.

Until both indexers answer, say so and do not coach a broadcast off the labels.
