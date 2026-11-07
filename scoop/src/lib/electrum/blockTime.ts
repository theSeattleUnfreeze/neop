/** Bitcoin block header timestamp is a little-endian uint32 at byte offset 68. */

export function blockTimeFromHeaderHex(headerHex: string): Date | null {
  const hex = headerHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(hex) || hex.length < 160) return null;
  const bytes = Buffer.from(hex.slice(0, 160), "hex");
  if (bytes.length < 72) return null;
  const seconds = bytes.readUInt32LE(68);
  if (seconds < 1231006505) return null;
  return new Date(seconds * 1000);
}

export type BlockTimeResolver = {
  timeForHeight: (height: number) => Promise<Date | null>;
};

/** Resolve confirm heights to block times, caching per height for one sync pass. */
export function createBlockTimeResolver(
  fetchHeader: (height: number) => Promise<string>
): BlockTimeResolver {
  const cache = new Map<number, Date | null>();
  return {
    async timeForHeight(height: number) {
      if (!Number.isFinite(height) || height <= 0) return null;
      if (cache.has(height)) return cache.get(height) ?? null;
      try {
        const header = await fetchHeader(height);
        const at = blockTimeFromHeaderHex(header);
        cache.set(height, at);
        return at;
      } catch {
        cache.set(height, null);
        return null;
      }
    },
  };
}
