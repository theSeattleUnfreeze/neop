import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { ElectrumClient, electrumTlsRejectUnauthorized } from "@/lib/electrum/client";
import type { StackConfig, StackService, StackStatusRow } from "@/lib/stack/types";
import { summarizeStack } from "@/lib/stack/summarize";

const PROBE_MS = 8_000;

type RpcInfo = {
  blocks?: number;
  headers?: number;
  initialblockdownload?: boolean;
  verificationprogress?: number;
};

async function readCookie(cookieFile: string): Promise<{ user: string; password: string } | null> {
  if (!cookieFile || !fs.existsSync(cookieFile)) return null;
  const raw = fs.readFileSync(cookieFile, "utf8").trim();
  const split = raw.indexOf(":");
  if (split <= 0) return null;
  return { user: raw.slice(0, split), password: raw.slice(split + 1) };
}

type RpcBody = { result?: RpcInfo; error?: { message?: string } };

export function rpcProbeFromHttp(
  status: number,
  body: RpcBody | null
): Pick<StackStatusRow, "state" | "height" | "headers" | "detail"> {
  if (status === 401) {
    return {
      state: "up",
      height: null,
      headers: null,
      detail: "RPC is there; credentials were not accepted.",
    };
  }
  if (status < 200 || status >= 300 || !body || body.error || !body.result) {
    const message = body?.error?.message || `HTTP ${status}`;
    return { state: "down", height: null, headers: null, detail: message };
  }
  const info = body.result;
  const ibd = info.initialblockdownload ? " still syncing" : "";
  const progress =
    typeof info.verificationprogress === "number"
      ? ` (${Math.min(100, info.verificationprogress * 100).toFixed(1)}%)`
      : "";
  return {
    state: "up",
    height: typeof info.blocks === "number" ? info.blocks : null,
    headers: typeof info.headers === "number" ? info.headers : null,
    detail: `RPC answering${ibd}${progress}`,
  };
}

async function rpcAuthorization(svc: StackService): Promise<string | null> {
  if (svc.rpcUser) {
    return Buffer.from(`${svc.rpcUser}:${svc.rpcPassword}`).toString("base64");
  }
  const cookie = await readCookie(svc.cookieFile);
  if (!cookie) return null;
  return Buffer.from(`${cookie.user}:${cookie.password}`).toString("base64");
}

function postRpc(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; text: string; location: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttps = target.protocol === "https:";
    const req = (isHttps ? https : http).request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}` || "/",
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        rejectUnauthorized: electrumTlsRejectUnauthorized(),
        timeout: PROBE_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
            location: Array.isArray(res.headers.location)
              ? (res.headers.location[0] ?? "")
              : (res.headers.location ?? ""),
          })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Timed out.")));
    req.end(body);
  });
}

function rpcFromResponse(res: { status: number; text: string }): Pick<
  StackStatusRow,
  "state" | "height" | "headers" | "detail"
> {
  if (res.status === 401) return rpcProbeFromHttp(401, null);
  let parsed: RpcBody | null = null;
  try {
    parsed = JSON.parse(res.text) as RpcBody;
  } catch {
    parsed = null;
  }
  return rpcProbeFromHttp(res.status, parsed);
}

async function probeRpc(svc: StackService): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No RPC URL yet." };
  }
  const headers: Record<string, string> = { "content-type": "text/plain" };
  const authorization = await rpcAuthorization(svc);
  if (authorization) headers.authorization = `Basic ${authorization}`;
  const body = JSON.stringify({
    jsonrpc: "1.0",
    id: "scoop",
    method: "getblockchaininfo",
    params: [],
  });
  const urls = [svc.endpoint];
  if (svc.endpoint.startsWith("http://")) {
    urls.push(`https://${svc.endpoint.slice("http://".length)}`);
  }
  const settled = await new Promise<{
    good: { status: number; text: string; location: string } | null;
    redirect: { status: number; text: string; location: string } | null;
    fallback: { status: number; text: string; location: string } | null;
    error: string;
  }>((resolve) => {
    let pending = urls.length;
    let redirect: { status: number; text: string; location: string } | null = null;
    let fallback: { status: number; text: string; location: string } | null = null;
    let error = "fetch failed";
    const finish = () => resolve({ good: null, redirect, fallback, error });
    for (const url of urls) {
      postRpc(url, headers, body).then(
        (res) => {
          if (res.status === 401 || (res.status >= 200 && res.status < 300)) {
            resolve({ good: res, redirect, fallback, error });
            return;
          }
          if (res.status >= 300 && res.status < 400 && res.location) redirect = res;
          else fallback = res;
          pending -= 1;
          if (pending === 0) finish();
        },
        (err: unknown) => {
          error = err instanceof Error ? err.message : String(err);
          pending -= 1;
          if (pending === 0) finish();
        }
      );
    }
  });
  if (settled.good) return rpcFromResponse(settled.good);
  if (settled.redirect?.location) {
    try {
      const followed = await postRpc(new URL(settled.redirect.location, svc.endpoint).toString(), headers, body);
      if (followed.status === 401 || (followed.status >= 200 && followed.status < 300)) {
        return rpcFromResponse(followed);
      }
    } catch {
      // The redirect target failed; report the redirect below.
    }
  }
  if (settled.fallback) return rpcFromResponse(settled.fallback);
  if (settled.redirect) return rpcFromResponse(settled.redirect);
  const open = await endpointTcpOpen(svc.endpoint);
  if (open) {
    return {
      state: "down",
      height: null,
      headers: null,
      detail: "Port is open; RPC timed out (node may be syncing).",
    };
  }
  return { state: "down", height: null, headers: null, detail: settled.error };
}

function endpointTcpOpen(endpoint: string): Promise<boolean> {
  try {
    let host = "";
    let port = 0;
    if (endpoint.startsWith("tcp://") || endpoint.startsWith("ssl://") || endpoint.startsWith("tls://")) {
      const rest = endpoint.replace(/^(tcp|ssl|tls):\/\//, "");
      const parts = rest.split(":");
      host = parts[0] ?? "";
      port = Number(parts[1]);
    } else {
      const url = new URL(endpoint);
      host = url.hostname;
      port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    }
    if (!host || !Number.isFinite(port)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const sock = net.connect({ host, port });
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, 1200);
      sock.on("connect", () => {
        clearTimeout(timer);
        sock.end();
        resolve(true);
      });
      sock.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function probeElectrum(
  svc: StackService
): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No Electrum URL yet." };
  }
  const client = ElectrumClient.fromUrl(svc.endpoint);
  try {
    await client.connect(PROBE_MS);
    const version = (await client.serverVersion()) as unknown;
    const banner = Array.isArray(version) ? String(version[0]) : "Electrum";
    const tip = (await client.call("blockchain.headers.subscribe", [])) as { height?: number };
    const height = typeof tip?.height === "number" ? tip.height : null;
    return {
      state: "up",
      height,
      headers: height,
      detail: height != null ? `${banner} tip ${height.toLocaleString()}` : banner,
    };
  } catch (err) {
    const open = await endpointTcpOpen(svc.endpoint);
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "down",
      height: null,
      headers: null,
      detail: open ? "Port is open; Electrum timed out (often waiting on bitcoind)." : message,
    };
  } finally {
    client.close();
  }
}

async function probeLink(
  svc: StackService
): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No tunnel RPC URL yet." };
  }
  return probeRpc(svc);
}

const TIMED_OUT: Pick<StackStatusRow, "state" | "height" | "headers" | "detail"> = {
  state: "down",
  height: null,
  headers: null,
  detail: "Timed out.",
};

function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

async function probeOne(svc: StackService): Promise<StackStatusRow> {
  let probed = await withDeadline(
    svc.id === "core-fulcrum" || svc.id === "knots-fulcrum"
      ? probeElectrum(svc)
      : svc.id === "knots-link"
        ? probeLink(svc)
        : probeRpc(svc),
    PROBE_MS,
    TIMED_OUT
  );
  if (probed.detail === "Timed out." && svc.endpoint) {
    const open = await endpointTcpOpen(svc.endpoint);
    if (open) {
      probed = {
        ...probed,
        detail:
          svc.id === "core-fulcrum" || svc.id === "knots-fulcrum"
            ? "Port is open; Electrum timed out (often waiting on bitcoind)."
            : "Port is open; RPC timed out (node may be syncing).",
      };
    }
  }
  return {
    id: svc.id,
    label: svc.label,
    control: svc.control,
    endpoint: svc.endpoint,
    configFile: svc.configFile,
    datadir: svc.datadir,
    files: svc.files,
    ...probed,
  };
}

export async function probeStack(config: StackConfig): Promise<{
  catalogReady: boolean;
  summary: string;
  rows: StackStatusRow[];
}> {
  const rows = await Promise.all(config.services.map((svc) => probeOne(svc)));
  const head = summarizeStack(rows);
  return { ...head, rows };
}
