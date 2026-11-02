import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyService,
  STACK_SERVICE_IDS,
  type StackConfig,
  type StackFileLink,
  type StackService,
  type StackServiceId,
} from "@/lib/stack/types";

export function defaultStackConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SCOOP_STACK_CONFIG?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".neop", "stack.json");
}

export function defaultStackConfig(env: NodeJS.ProcessEnv = process.env): StackConfig {
  const core = emptyService("core-node", "Core node", "local");
  core.endpoint = env.CORE_RPC_URL?.trim() || "http://127.0.0.1:8332";
  core.binary = env.CORE_BITCOIND?.trim() || "";
  core.datadir = env.CORE_DATADIR?.trim() || "";
  core.configFile = env.CORE_CONF?.trim() || "";
  core.cookieFile = env.CORE_COOKIE?.trim() || "";

  const coreFulcrum = emptyService("core-fulcrum", "Core Fulcrum", "local");
  coreFulcrum.endpoint = env.FULCRUM_URL?.trim() || "";
  coreFulcrum.configFile = env.CORE_FULCRUM_CONF?.trim() || "";
  coreFulcrum.datadir = env.CORE_FULCRUM_DATADIR?.trim() || "";
  coreFulcrum.containerName = env.CORE_FULCRUM_CONTAINER?.trim() || "";
  coreFulcrum.image = env.CORE_FULCRUM_IMAGE?.trim() || "";
  coreFulcrum.publish = env.CORE_FULCRUM_PUBLISH?.trim() || "";
  coreFulcrum.cookieFile = env.CORE_COOKIE?.trim() || core.cookieFile;

  const knots = emptyService("knots-node", "Knots node", "remote");
  knots.endpoint = env.KNOTS_RPC_URL?.trim() || "";

  const knotsFulcrum = emptyService("knots-fulcrum", "Knots Fulcrum", "remote");
  knotsFulcrum.endpoint = env.SHULCRUM_URL?.trim() || "";

  const link = emptyService("knots-link", "Knots RPC tunnel", "local");
  link.script = env.KNOTS_LINK_SCRIPT?.trim() || "";
  link.identityFile = env.KNOTS_LINK_IDENTITY?.trim() || "";
  link.logFile = env.KNOTS_LINK_LOG?.trim() || "";
  link.startosHost = env.KNOTS_LINK_HOST?.trim() || "";
  link.endpoint = env.KNOTS_RPC_URL?.trim() || "";

  return { services: [core, coreFulcrum, knots, knotsFulcrum, link] };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiles(value: unknown): StackFileLink[] {
  if (!Array.isArray(value)) return [];
  const out: StackFileLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = asString(rec.label);
    const filePath = asString(rec.path);
    if (!label || !filePath) continue;
    out.push({ label, path: filePath });
  }
  return out;
}

function mergeService(base: StackService, raw: unknown): StackService {
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const control = rec.control === "remote" || rec.control === "local" ? rec.control : base.control;
  return {
    ...base,
    label: asString(rec.label) || base.label,
    control,
    endpoint: asString(rec.endpoint) || base.endpoint,
    binary: asString(rec.binary),
    datadir: asString(rec.datadir),
    configFile: asString(rec.configFile),
    cookieFile: asString(rec.cookieFile),
    containerName: asString(rec.containerName),
    image: asString(rec.image),
    publish: asString(rec.publish),
    files: asFiles(rec.files),
    script: asString(rec.script),
    identityFile: asString(rec.identityFile),
    logFile: asString(rec.logFile),
    startosHost: asString(rec.startosHost),
  };
}

export function normalizeStackConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): StackConfig {
  const defaults = defaultStackConfig(env);
  const byId = new Map<StackServiceId, unknown>();
  if (raw && typeof raw === "object" && Array.isArray((raw as StackConfig).services)) {
    for (const item of (raw as StackConfig).services) {
      if (item && typeof item === "object" && STACK_SERVICE_IDS.includes((item as StackService).id)) {
        byId.set((item as StackService).id, item);
      }
    }
  }
  return {
    services: defaults.services.map((svc) => mergeService(svc, byId.get(svc.id))),
  };
}

export function loadStackConfig(
  filePath?: string,
  env: NodeJS.ProcessEnv = process.env
): StackConfig {
  const resolved = filePath ?? defaultStackConfigPath(env);
  if (!resolved || !fs.existsSync(resolved)) return defaultStackConfig(env);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  return normalizeStackConfig(parsed, env);
}

export function saveStackConfig(config: StackConfig, filePath: string = defaultStackConfigPath()): void {
  const normalized = normalizeStackConfig(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(normalized, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function serviceById(config: StackConfig, id: StackServiceId): StackService {
  const found = config.services.find((svc) => svc.id === id);
  if (!found) throw new Error(`unknown stack service ${id}`);
  return found;
}

/** Paths the operator is allowed to reveal in Explorer: configured files and their directories. */
export function revealablePaths(config: StackConfig): string[] {
  const paths: string[] = [];
  for (const svc of config.services) {
    for (const candidate of [
      svc.binary,
      svc.datadir,
      svc.configFile,
      svc.cookieFile,
      svc.script,
      svc.identityFile,
      svc.logFile,
      ...svc.files.map((file) => file.path),
    ]) {
      if (candidate) paths.push(path.resolve(candidate));
    }
  }
  return paths;
}
