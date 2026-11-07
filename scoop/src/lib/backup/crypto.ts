import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from "node:crypto";

export const BACKUP_FORMAT = "scoop-backup";

/** Interactive backup: scrypt N=2^15. Tests may use the smaller allowed N. */
export const BACKUP_SCRYPT = { n: 32768, r: 8, p: 1 } as const;

const ALLOWED_N = new Set([16384, 32768, 65536]);

export type ScryptParams = { n: number; r: number; p: number };

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  kdf: { name: "scrypt"; salt: string } & ScryptParams;
  nonce: string;
  ciphertext: string;
};

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCryptoError";
  }
}

function assertParams(params: ScryptParams): void {
  if (!ALLOWED_N.has(params.n) || params.r !== 8 || params.p !== 1) {
    throw new BackupCryptoError("unsupported backup key derivation");
  }
}

function scryptKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  assertParams(params);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: params.n, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function encryptBackup(
  plaintext: string,
  password: string,
  params: ScryptParams = BACKUP_SCRYPT
): Promise<BackupEnvelope> {
  if (password.length < 8) {
    throw new BackupCryptoError("backup password must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await scryptKey(password, salt, params);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);
  return {
    format: BACKUP_FORMAT,
    version: 1,
    kdf: {
      name: "scrypt",
      salt: salt.toString("base64"),
      n: params.n,
      r: params.r,
      p: params.p,
    },
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function decryptBackup(envelope: BackupEnvelope, password: string): Promise<string> {
  if (envelope.format !== BACKUP_FORMAT || envelope.version !== 1 || envelope.kdf?.name !== "scrypt") {
    throw new BackupCryptoError("unrecognized backup file");
  }
  let salt: Buffer;
  let nonce: Buffer;
  let packed: Buffer;
  try {
    salt = Buffer.from(envelope.kdf.salt, "base64");
    nonce = Buffer.from(envelope.nonce, "base64");
    packed = Buffer.from(envelope.ciphertext, "base64");
  } catch {
    throw new BackupCryptoError("unrecognized backup file");
  }
  if (salt.length !== 16 || nonce.length !== 12 || packed.length < 17) {
    throw new BackupCryptoError("unrecognized backup file");
  }
  const key = await scryptKey(password, salt, envelope.kdf);
  const tag = packed.subarray(packed.length - 16);
  const body = packed.subarray(0, packed.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new BackupCryptoError("Could not decrypt the backup. Check the password.");
  }
}

export function parseEnvelope(raw: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupCryptoError("unrecognized backup file");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BackupCryptoError("unrecognized backup file");
  }
  return parsed as BackupEnvelope;
}
