import net from "node:net";
import tls from "node:tls";

export type ElectrumUrl = {
  host: string;
  port: number;
  tls: boolean;
};

export function parseElectrumUrl(url: string): ElectrumUrl {
  const raw = url.trim();
  let tlsFlag = false;
  let rest = raw;
  if (raw.startsWith("ssl://") || raw.startsWith("tls://")) {
    tlsFlag = true;
    rest = raw.replace(/^ssl:\/\//, "").replace(/^tls:\/\//, "");
  } else if (raw.startsWith("tcp://")) {
    rest = raw.slice("tcp://".length);
  }
  const [host, portStr] = rest.split(":");
  const port = Number(portStr);
  if (!host || !Number.isFinite(port)) {
    throw new Error(`invalid Electrum URL: ${url}`);
  }
  return { host, port, tls: tlsFlag };
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

/**
 * Minimal Electrum JSON-RPC client (newline-delimited).
 * Used against Fulcrum (Core) and Shulcrum (Knots).
 */
export class ElectrumClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly target: ElectrumUrl) {}

  static fromUrl(url: string): ElectrumClient {
    return new ElectrumClient(parseElectrumUrl(url));
  }

  async connect(timeoutMs = 10_000): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        socket.off("error", onError);
        socket.off("connect", onConnect);
        socket.off("secureConnect", onConnect);
      };
      const socket = this.target.tls
        ? tls.connect({ host: this.target.host, port: this.target.port, servername: this.target.host })
        : net.connect({ host: this.target.host, port: this.target.port });
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("error", onError);
      if (this.target.tls) socket.once("secureConnect", onConnect);
      else socket.once("connect", onConnect);
      setTimeout(() => onError(new Error("electrum connect timeout")), timeoutMs);
    });
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    for (const [, p] of this.pending) p.reject(new Error("electrum closed"));
    this.pending.clear();
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    if (!this.socket) await this.connect();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async serverVersion(): Promise<unknown> {
    return this.call("server.version", ["scoop", "1.4"]);
  }

  async getHistory(scripthash: string): Promise<unknown> {
    return this.call("blockchain.scripthash.get_history", [scripthash]);
  }

  async listUnspent(scripthash: string): Promise<unknown> {
    return this.call("blockchain.scripthash.listunspent", [scripthash]);
  }

  async getBalance(scripthash: string): Promise<unknown> {
    return this.call("blockchain.scripthash.get_balance", [scripthash]);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const pending = this.pending.get(msg.id);
      if (!pending) continue;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message ?? "electrum error"));
      else pending.resolve(msg.result);
    }
  }
}
