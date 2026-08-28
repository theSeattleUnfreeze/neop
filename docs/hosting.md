# Host compatibility

Primary runtime is **Linux**. Thin macOS hosts run neop via Colima/VM; datadir may live on external disk.

| Host | Role |
|------|------|
| **Linux x86_64** | Primary supported runtime for `neopd` + compose |
| **MacBook (macOS 12.7.6 Monterey) + USB HDD** | Personal host: datadir on USB; **runtime = Linux via Colima/VM** (Monterey is thin). On-demand uptime OK. |
| **StartOS (Knots + CLN)** | Always-on SHA-256 peer / IBD / LN only — **not** the Blake2b / `neopd` host |
| **Windows dual-boot Linux** | testnet4 scratch only — not primary mainnet archive |

## Profiles

### `linux-x86_64` (primary)

- Run `docker-compose.testnet4.yml` (or native pinned Core/Knots + `neopd`) on Linux.
- Keep testnet4 and mainnet datadirs strictly separate.

### `macos-12-monterey` (Colima + USB datadir)

- Do not treat stock macOS 12 as the consensus runtime.
- Start a Linux VM (Colima or equivalent); mount the USB volume into the VM for `./data/…`.
- RPC binds to localhost on the VM; expose to the Mac only if you understand the trust boundary.

### StartOS (peer-only)

- Use for SHA-256 IBD / peering and Lightning — not as the dual-flavor wallet host.
- Wallet non-legacy tip tracks **Blake2b Knots**, not a stalled RDTS SHA-256 flavor switch on StartOS.

## Disk layout (conceptual)

```
data/
  testnet4/
    blocks/                 # shared SHA-256 archive
    chainstate-legacy/
    chainstate-blake2b/
    electrum/
  main/                     # gated; not for early development
    …
```

Placeholders in examples: `STARTOS_HOST`, `USB_DATADIR`, `VPS_PUBLIC_IP` — never commit real hostnames or credentials.
