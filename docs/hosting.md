# Host compatibility

Primary runtime is **Linux**. Thin macOS hosts run neop via Colima/VM; datadir may live on external disk.

| Host | Role |
|------|------|
| **Linux x86_64** | Primary supported runtime for `neopd` + compose |
| **MacBook (macOS 12.7.6 Monterey) + USB HDD** | Personal host: datadir on USB; **runtime = Linux via Colima/VM** (Monterey is thin). On-demand uptime OK. |
| **StartOS (Knots + CLN + Fulcrum)** | Always-on Knots tip / LN / Electrum peer. Scoop and wallets on another host use StartOS **Interfaces** URLs (Bitcoin RPC LAN often **`:57747`**; Fulcrum Electrum **SSL** is a **dynamic** port — copy `ssl://…`). Prefer LAN IP if `*.local` mDNS fails. Not the dual-flavor `neopd` host. |
| **Umbrel** | Same idea as StartOS for a packaged node + Electrum: copy addresses from the app UI into Scoop `FULCRUM_URL` / `SHULCRUM_URL`. |
| **Windows dual-boot Linux** | testnet4 scratch only — not primary mainnet archive |

## Profiles

### `linux-x86_64` (primary)

- Run `docker-compose.testnet4.yml` (or native pinned Core/Knots + `neopd`) on Linux.
- Keep testnet4 and mainnet datadirs strictly separate.

### `macos-12-monterey` (Colima + USB datadir)

- Do not treat stock macOS 12 as the consensus runtime.
- Start a Linux VM (Colima or equivalent); mount the USB volume into the VM for `./data/…`.
- RPC binds to localhost on the VM; expose to the Mac only if you understand the trust boundary.

### StartOS (Knots tip + Electrum)

- Run Blake2b **Knots** + **Fulcrum** (e.g. privkeyio fulcrum-startos) on StartOS for the Knots tip.
- Scoop / Sparrow / Shrike on another machine: open Fulcrum → **Interfaces** → **Electrum (SSL)**, copy the `ssl://` URL. Ports are **assigned by StartOS** (not fixed `50002`). Bitcoin Knots RPC on LAN is commonly **`57747`**.
- If `something.local` does not resolve, use the StartOS LAN IP.
- Self-hosted Linux Fulcrum still defaults to **50001** (tcp) / **50002** (ssl) — see [electrum.md](electrum.md).
- Dual-flavor `neopd` + shared archive still belongs on a Linux neop host ([deploy-metal.md](deploy-metal.md)), not inside StartOS.

### Umbrel

- Point Scoop at the Electrum / Fulcrum addresses Umbrel shows in its UI (LAN or Tor). Same env vars as StartOS.
## Disk layout (conceptual)

```
data/
  testnet4/
    blocks/                 # shared SHA-256d archive (blk/rev ≤ cut-off)
    blocks-core/            # Core tip: symlinks into blocks/ + private tip files
    blocks-knots/           # Knots tip: same pattern (post-Blake2b tip is private)
    chainstate-legacy/
    chainstate-blake2b/
    electrum/
  main/                     # gated; not for early development
    …
```

### Shared pre-split `blk` / `rev` ceremony

`neopd` is the runtime mux; the one-shot filesystem ceremony for a shared
SHA-256d archive lives in [`scripts/archive-blocks.sh`](../scripts/archive-blocks.sh).

That helper adapts safety rules from
[FlyTheElephant1/archive-blocks.sh](https://github.com/FlyTheElephant1/archive-blocks.sh)
(GPL-2.0): idempotent symlinks, never overwrite a real file with a symlink,
owner/mode checks against the reference `blocks/` dir, and a conservative
mtime-based cut-off recipe.

```bash
# Suggest a cut-off (file numbers are NOT heights):
./scripts/archive-blocks.sh -i /path/to/node/blocks --suggest-cutoff

# Move ≤ cut-off into the shared archive; leave symlinks in the source:
./scripts/archive-blocks.sh -i /path/to/node/blocks -o /path/to/shared/blocks -n 05687

# Bootstrap a second flavor's blocks/ as symlinks into the archive:
./scripts/archive-blocks.sh -i /path/to/node/blocks -o /path/to/shared/blocks \
  -a /path/to/blocks-knots -n 05687
```

Do **not** put post–Blake2b (v2-header) tip files in the shared archive.
Stop nodes before archive mode if the newest `blk*.dat` may still be open.
Bootstrap mode does **not** copy `blocks/index/` (each flavor rebuilds its own)
and does **not** touch `chainstate-*` or Electrum indexes.

### Operator stories (what this ceremony buys you)

**Completely new dual-flavor operator**

1. IBD **once** on SHA-256d history into one engine’s `blocks/` (or let `neopd`
   compose drive the first tip).
2. Choose a conservative cut-off (`--suggest-cutoff`), archive ≤ cut-off into
   `data/<network>/blocks/`, symlink the first tip back.
3. Bootstrap the other tip (`blocks-core/` or `blocks-knots/`) with `-a` so
   pre-fork `blk`/`rev` are shared — no second download of common history.
4. Let each engine grow **private tip files** after the cut-off and build its
   own `chainstate-*`.
5. Run **Fulcrum** (Core) and **Shulcrum** (Knots) against those tips; point
   Sparrow / Shrike (or your preferred wallets) at the matching Electrum ports.

**Existing one-flavor operator**

1. Stop the synced node. Archive its pre-split `blk`/`rev` into the shared
   archive; existing tip keeps working via symlinks (no reindex of the side
   you already support; no re-download of shared pre-fork files).
2. Bootstrap the **other** flavor’s `blocks-*` with `-a`.
3. Expect to **download and index only the other side’s post-split tip**, and
   to build a **full chainstate for that other flavor only**.
4. Do **not** reindex the already-supported flavor’s chainstate, and do **not**
   reindex shared pre-fork headers/PoW history for either flavor — they share
   the same SHA-256d archive through the cut-off.

Placeholders in examples: `STARTOS_HOST`, `USB_DATADIR`, `VPS_PUBLIC_IP` — never commit real hostnames or credentials.

Reuse an existing `blocks/` archive without a second IBD: [deploy-metal.md](deploy-metal.md). Wallets: [wallets.md](wallets.md). Electrum (Fulcrum + Shulcrum only): [electrum.md](electrum.md).
