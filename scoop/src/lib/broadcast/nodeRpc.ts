/** JSON-RPC to the operator's own Core and Knots. Do not log params or results. */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { loadStackConfig, serviceById } from "@/lib/stack/config";
import type { StackServiceId } from "@/lib/stack/types";

export type RpcTarget = "core" | "knots";

function serviceId(target: RpcTarget): StackServiceId {
  return target === "core" ? "core-node" : "knots-node";
}

function authHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function credentials(cookieFile: string, rpcUser: string, rpcPassword: string): { user: string; password: string } | null {
  if (rpcUser && rpcPassword) return { user: rpcUser, password: rpcPassword };
  if (!cookieFile || !fs.existsSync(cookieFile)) return null;
  const raw = fs.readFileSync(cookieFile, "utf8").trim();
  const split = raw.indexOf(":");
  if (split <= 0) return null;
  return { user: raw.slice(0, split), password: raw.slice(split + 1) };
}

export function scrubRpcText(text: string): string {
  return text.replace(/\b[0-9a-fA-F]{16,}\b/g, "…").slice(0, 240);
}

export async function nodeRpc(target: RpcTarget, method: string, params: unknown[] = []): Promise<unknown> {
  const config = loadStackConfig();
  const service = serviceById(config, serviceId(target));
  const endpoint = service.endpoint.trim();
  if (!endpoint) throw new Error(`${target} RPC URL is not set in the stack file.`);
  const creds = credentials(service.cookieFile, service.rpcUser, service.rpcPassword);
  if (!creds) throw new Error(`${target} RPC credentials are not in the stack file.`);
  const url = new URL(endpoint);
  const body = JSON.stringify({ jsonrpc: "1.0", id: "scoop", method, params });
  const lib = url.protocol === "https:" ? https : http;
  const ip = isIP(url.hostname);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname || "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authHeader(creds.user, creds.password),
          "content-length": Buffer.byteLength(body),
        },
        rejectUnauthorized: ip === 0,
        servername: ip === 0 ? url.hostname : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: { result?: unknown; error?: { message?: string } | null };
          try {
            parsed = JSON.parse(text) as { result?: unknown; error?: { message?: string } | null };
          } catch {
            reject(new Error(`${target} RPC did not return JSON.`));
            return;
          }
          if (parsed.error) {
            reject(new Error(scrubRpcText(parsed.error.message || `${target} RPC rejected the call.`)));
            return;
          }
          resolve(parsed.result);
        });
      }
    );
    req.setTimeout(8_000, () => req.destroy(new Error(`${target} RPC timed out.`)));
    req.on("error", (err) => reject(new Error(scrubRpcText(err.message))));
    req.write(body);
    req.end();
  });
}
