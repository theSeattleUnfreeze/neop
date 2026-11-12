import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";
import * as ecc from "tiny-secp256k1";

const HEADER_LEN = 28;
const MAGIC = "SPRW1";
const ECIES_MAGIC = Buffer.from("BIE1");
const XPUB_RE = /^(xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{50,}$/;

const SCRIPT_PATH: Record<string, string> = {
  P2WPKH: "m/84'/0'/0'",
  P2SH_P2WPKH: "m/49'/0'/0'",
  P2PKH: "m/44'/0'/0'",
  P2TR: "m/86'/0'/0'",
};

export type SparrowAccount = {
  label: string;
  xpub: string;
  derivationPath: string;
  masterFingerprint: string;
};

export type SparrowWalletView = {
  name: string;
  policyType: string;
  scriptType: string;
  accounts: SparrowAccount[];
  note: string;
};

type DeriveKey = (password: string, salt: Buffer) => Promise<Buffer>;

let argon2Derive: DeriveKey | null = null;

async function defaultDerive(password: string, salt: Buffer): Promise<Buffer> {
  if (!argon2Derive) {
    const { argon2id } = await import("hash-wasm");
    argon2Derive = async (pw, s) => {
      const hash = await argon2id({
        password: pw,
        salt: s,
        parallelism: 4,
        iterations: 10,
        memorySize: 256 * 1024,
        hashLength: 32,
        outputType: "binary",
      });
      return Buffer.from(hash);
    };
  }
  return argon2Derive(password, salt);
}

export function sparrowHeader(bytes: Buffer): { encrypted: boolean; salt?: Buffer } {
  const text = bytes.subarray(0, 1).toString("utf8");
  if (text === "{" || text === "[") return { encrypted: false };
  if (bytes.length < HEADER_LEN) return { encrypted: false };
  const header = bytes.subarray(0, HEADER_LEN).toString("ascii");
  let decoded: Buffer;
  try {
    decoded = Buffer.from(header, "base64");
  } catch {
    return { encrypted: false };
  }
  if (decoded.length < 21 || decoded.subarray(0, 5).toString("ascii") !== MAGIC) {
    return { encrypted: false };
  }
  return { encrypted: true, salt: Buffer.from(decoded.subarray(5, 21)) };
}

function sharedSecret(publicKey: Uint8Array, privateKey: Uint8Array): Buffer {
  const point = ecc.pointMultiply(publicKey, privateKey, true);
  if (!point) throw new Error("Could not derive the Sparrow encryption key.");
  return Buffer.from(point);
}

export function encryptEciesPayload(recipientPub: Uint8Array, plaintext: Buffer, ephemeralPriv: Uint8Array): Buffer {
  const ephemeralPub = ecc.pointFromScalar(ephemeralPriv, true);
  if (!ephemeralPub) throw new Error("bad ephemeral key");
  const hash = createHash("sha512").update(sharedSecret(recipientPub, ephemeralPriv)).digest();
  const iv = hash.subarray(0, 16);
  const keyE = hash.subarray(16, 32);
  const keyM = hash.subarray(32, 64);
  const cipher = createCipheriv("aes-128-cbc", keyE, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const encrypted = Buffer.concat([ECIES_MAGIC, Buffer.from(ephemeralPub), ciphertext]);
  const mac = createHmac("sha256", keyM).update(encrypted).digest();
  return Buffer.from(Buffer.concat([encrypted, mac]).toString("base64"), "ascii");
}

function decryptEciesPayload(payload: Buffer, privateKey: Uint8Array): Buffer {
  const decoded = Buffer.from(payload.toString("ascii").trim(), "base64");
  if (decoded.length < 85) throw new Error("Sparrow wallet ciphertext is too short.");
  const magic = decoded.subarray(0, 4);
  if (!magic.equals(ECIES_MAGIC)) throw new Error("Not a Sparrow encrypted wallet.");
  const ephemeralPub = decoded.subarray(4, 37);
  const mac = decoded.subarray(decoded.length - 32);
  const ciphertext = decoded.subarray(37, decoded.length - 32);
  const hash = createHash("sha512").update(sharedSecret(ephemeralPub, privateKey)).digest();
  const iv = hash.subarray(0, 16);
  const keyE = hash.subarray(16, 32);
  const keyM = hash.subarray(32, 64);
  const expected = createHmac("sha256", keyM).update(decoded.subarray(0, decoded.length - 32)).digest();
  if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) {
    throw new Error("That password did not open this Sparrow wallet.");
  }
  const decipher = createDecipheriv("aes-128-cbc", keyE, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function buildSparrowHeader(salt: Buffer): Buffer {
  const raw = Buffer.concat([Buffer.from(MAGIC, "ascii"), salt.subarray(0, 16)]);
  const encoded = raw.toString("base64");
  if (encoded.length !== HEADER_LEN) throw new Error("header length");
  return Buffer.from(encoded, "ascii");
}

export async function openSparrowBytes(
  bytes: Buffer,
  password?: string,
  derive: DeriveKey = defaultDerive
): Promise<unknown> {
  if (bytes.subarray(0, 3).toString("utf8") === "H:2") {
    throw new Error(
      "File → Export Wallet → Sparrow writes a .mv.db database, which Scoop cannot read yet. Open the wallet, go to Settings, and copy the account Extended Public Key into Scoop."
    );
  }
  const header = sparrowHeader(bytes);
  if (!header.encrypted) {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  }
  if (!password) throw new Error("This Sparrow wallet is encrypted. Enter its password.");
  if (!header.salt) throw new Error("Sparrow wallet header is missing a salt.");
  const priv = await derive(password, header.salt);
  try {
    const inflated = decryptEciesPayload(bytes.subarray(HEADER_LEN), priv);
    const json = inflateSync(inflated).toString("utf8");
    return JSON.parse(json) as unknown;
  } finally {
    priv.fill(0);
  }
}

/** Test helper: wrap JSON the way Sparrow's SPRW1 file does, with a caller-supplied key. */
export function sealSparrowForTest(json: string, recipientPriv: Uint8Array, ephemeralPriv: Uint8Array, salt: Buffer): Buffer {
  const pub = ecc.pointFromScalar(recipientPriv, true);
  if (!pub) throw new Error("bad recipient");
  const payload = encryptEciesPayload(pub, deflateSync(Buffer.from(json, "utf8")), ephemeralPriv);
  return Buffer.concat([buildSparrowHeader(salt), payload]);
}

function pushAccount(accounts: SparrowAccount[], candidate: SparrowAccount) {
  if (!XPUB_RE.test(candidate.xpub)) return;
  if (accounts.some((account) => account.xpub === candidate.xpub)) return;
  accounts.push(candidate);
}

function walk(node: unknown, accounts: SparrowAccount[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, accounts);
    return;
  }
  const rec = node as Record<string, unknown>;
  const deriv =
    rec.keyDerivation && typeof rec.keyDerivation === "object"
      ? (rec.keyDerivation as Record<string, unknown>)
      : null;
  const xpub =
    typeof rec.extendedPublicKey === "string"
      ? rec.extendedPublicKey
      : typeof rec.xpub === "string"
        ? rec.xpub
        : typeof deriv?.xpub === "string"
          ? deriv.xpub
          : "";
  const derivationPath =
    typeof rec.derivationPath === "string"
      ? rec.derivationPath
      : typeof rec.derivation === "string"
        ? rec.derivation
        : typeof deriv?.derivationPath === "string"
          ? deriv.derivationPath
          : "";
  const masterFingerprint =
    typeof deriv?.masterFingerprint === "string"
      ? deriv.masterFingerprint
      : typeof rec.root_fingerprint === "string"
        ? rec.root_fingerprint
        : typeof rec.masterFingerprint === "string"
          ? rec.masterFingerprint
          : "";
  const label = typeof rec.label === "string" ? rec.label : "";
  if (xpub) pushAccount(accounts, { label, xpub, derivationPath, masterFingerprint });
  for (const [key, value] of Object.entries(rec)) {
    if (key === "seed" || key === "mnemonic" || key === "masterPrivateExtendedKey") continue;
    if (value && typeof value === "object") walk(value, accounts);
  }
}

function isElectrumWallet(rec: Record<string, unknown>): boolean {
  return typeof rec.wallet_type === "string" && rec.keystore != null && typeof rec.keystore === "object";
}

export function viewFromWalletJson(parsed: unknown): SparrowWalletView {
  if (!parsed || typeof parsed !== "object") throw new Error("Sparrow wallet JSON was empty.");
  const rec = parsed as Record<string, unknown>;
  const accounts: SparrowAccount[] = [];
  walk(parsed, accounts);
  const scriptType = typeof rec.scriptType === "string" ? rec.scriptType : "";
  const fallback = SCRIPT_PATH[scriptType] ?? "";
  for (const account of accounts) {
    if (!account.derivationPath && fallback) account.derivationPath = fallback;
  }
  if (!accounts.length) {
    throw new Error("No extended public key in that file. Paste the account xpub from Sparrow instead.");
  }
  const policyType = typeof rec.policyType === "string" ? rec.policyType : "";
  const electrum = isElectrumWallet(rec);
  const keystore =
    electrum && rec.keystore && typeof rec.keystore === "object"
      ? (rec.keystore as Record<string, unknown>)
      : null;
  const name =
    typeof rec.name === "string" && rec.name
      ? rec.name
      : typeof keystore?.label === "string"
        ? keystore.label
        : "";
  const note =
    policyType === "MULTI"
      ? "This is a multisig wallet. Scoop can watch one cosigner xpub, which is not the multisig script. Paste an output descriptor if you have one."
      : electrum
        ? "Electrum wallet export. Scoop keeps the account xpub and derivation path only."
        : "";
  return {
    name,
    policyType: policyType || (electrum ? "SINGLE" : ""),
    scriptType,
    accounts,
    note,
  };
}

export async function inspectSparrowWallet(bytes: Buffer, password?: string): Promise<SparrowWalletView> {
  const parsed = await openSparrowBytes(bytes, password);
  return viewFromWalletJson(parsed);
}
