import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { StackConfig, StackService } from "@/lib/stack/types";

export type CoreProcess = {
  executable: string;
  commandLine: string;
};

export type DockerMount = {
  Source?: string;
  Destination?: string;
};

export type DiscoveredPaths = {
  binary: string;
  datadir: string;
  configFile: string;
  cookieFile: string;
};

const BLANK_PATHS: DiscoveredPaths = { binary: "", datadir: "", configFile: "", cookieFile: "" };

/** Value of `-name=value` or `-name value` on a bitcoind command line. */
export function argValue(commandLine: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = commandLine.match(new RegExp(`(?:^|\\s)--?${escaped}(?:=|\\s+)("[^"]+"|\\S+)`, "i"));
  if (!match) return "";
  return match[1].replace(/^"|"$/g, "");
}

function hasFlag(commandLine: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)--?${name}(?:\\s|=|$)`, "i").test(commandLine);
}

/** Chain folder under the data directory. Empty means mainnet, whose cookie sits in the datadir root. */
export function chainSubdir(commandLine: string): string {
  if (hasFlag(commandLine, "testnet4")) return "testnet4";
  if (hasFlag(commandLine, "testnet")) return "testnet3";
  if (hasFlag(commandLine, "signet")) return "signet";
  if (hasFlag(commandLine, "regtest")) return "regtest";
  const chain = argValue(commandLine, "chain").toLowerCase();
  if (chain === "testnet4") return "testnet4";
  if (chain === "test" || chain === "testnet") return "testnet3";
  if (chain === "signet" || chain === "regtest") return chain;
  return "";
}

export function defaultBitcoinDatadir(
  platform: NodeJS.Platform,
  env: { APPDATA?: string; HOME?: string }
): string {
  if (platform === "win32") return env.APPDATA ? path.win32.join(env.APPDATA, "Bitcoin") : "";
  if (platform === "darwin") {
    return env.HOME ? path.posix.join(env.HOME, "Library", "Application Support", "Bitcoin") : "";
  }
  return env.HOME ? path.posix.join(env.HOME, ".bitcoin") : "";
}

export function corePathsFromProcess(
  proc: CoreProcess,
  opts?: { platform?: NodeJS.Platform; env?: { APPDATA?: string; HOME?: string } }
): DiscoveredPaths {
  const platform = opts?.platform ?? process.platform;
  const lib = platform === "win32" ? path.win32 : path.posix;
  const datadir =
    argValue(proc.commandLine, "datadir") ||
    defaultBitcoinDatadir(platform, opts?.env ?? process.env);
  const chain = chainSubdir(proc.commandLine);
  const configFile = argValue(proc.commandLine, "conf") || (datadir ? lib.join(datadir, "bitcoin.conf") : "");
  const cookieFile =
    argValue(proc.commandLine, "rpccookiefile") ||
    (datadir ? lib.join(datadir, chain, ".cookie") : "");
  return {
    binary: proc.executable.trim(),
    datadir,
    configFile,
    cookieFile,
  };
}

export function fulcrumPathsFromMounts(mounts: DockerMount[]): DiscoveredPaths {
  const found = { ...BLANK_PATHS };
  for (const mount of mounts) {
    const source = mount.Source?.trim() || "";
    const dest = (mount.Destination || "").replace(/\\/g, "/");
    if (!source || !dest) continue;
    if (dest === "/data" || dest.endsWith("/data")) found.datadir = source;
    if (dest.endsWith(".conf")) found.configFile = source;
    if (dest.toLowerCase().includes("cookie")) found.cookieFile = source;
  }
  return found;
}

function fillBlanks(svc: StackService, found: DiscoveredPaths, exists: (candidate: string) => boolean): StackService {
  const next = { ...svc };
  const take = (key: keyof DiscoveredPaths) => {
    if (next[key]) return;
    const candidate = found[key];
    if (candidate && exists(candidate)) next[key] = candidate;
  };
  take("binary");
  take("datadir");
  take("configFile");
  take("cookieFile");
  return next;
}

export function applyDiscoveredPaths(
  config: StackConfig,
  found: { core?: DiscoveredPaths; fulcrum?: DiscoveredPaths },
  exists: (candidate: string) => boolean = fs.existsSync
): StackConfig {
  const services = config.services.map((svc) => ({ ...svc }));
  const core = services.find((svc) => svc.id === "core-node");
  const fulcrum = services.find((svc) => svc.id === "core-fulcrum");
  if (core && found.core) {
    const index = services.indexOf(core);
    services[index] = fillBlanks(core, found.core, exists);
  }
  if (fulcrum && found.fulcrum) {
    const index = services.indexOf(fulcrum);
    services[index] = fillBlanks(fulcrum, found.fulcrum, exists);
  }
  const coreNow = services.find((svc) => svc.id === "core-node");
  const fulcrumNow = services.find((svc) => svc.id === "core-fulcrum");
  if (fulcrumNow && !fulcrumNow.cookieFile && coreNow?.cookieFile && exists(coreNow.cookieFile)) {
    fulcrumNow.cookieFile = coreNow.cookieFile;
  }
  return { ...config, services };
}

function run(command: string, args: string[], ms = 8000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(stdout);
    }, ms);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(stdout);
    });
  });
}

async function readBitcoindProcess(): Promise<CoreProcess | null> {
  if (process.platform === "win32") {
    const stdout = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name = 'bitcoind.exe'\" | Select-Object -First 1 ExecutablePath, CommandLine | ConvertTo-Json -Compress",
    ]);
    const start = stdout.indexOf("{");
    if (start < 0) return null;
    try {
      const parsed = JSON.parse(stdout.slice(start)) as { ExecutablePath?: string; CommandLine?: string };
      if (!parsed.ExecutablePath || !parsed.CommandLine) return null;
      return {
        executable: await resolveExecutable(parsed.ExecutablePath),
        commandLine: parsed.CommandLine,
      };
    } catch {
      return null;
    }
  }
  const stdout = await run("ps", ["-ax", "-o", "command="]);
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /(^|\/)bitcoind(\s|$)/.test(item));
  if (!line) return null;
  const executable = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(/\s+/)[0];
  return { executable: await resolveExecutable(executable), commandLine: line };
}

/** `ps` often reports a bare `bitcoind` when it was started from PATH. */
async function resolveExecutable(executable: string): Promise<string> {
  if (!executable || executable.includes("/") || executable.includes("\\")) return executable;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const stdout = await run(locator, [executable]);
  const found = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.toLowerCase().startsWith("info:"));
  return found || executable;
}

async function readDockerMounts(containerName: string): Promise<DockerMount[] | null> {
  if (!containerName) return null;
  const stdout = await run("docker", ["inspect", containerName, "--format", "{{json .Mounts}}"]);
  const start = stdout.indexOf("[");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as DockerMount[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fill blank Core and Core Fulcrum paths from the running bitcoind process and
 * from the Fulcrum container's mounts. Saved paths win. Nothing is written.
 */
export async function discoverStackPaths(config: StackConfig): Promise<StackConfig> {
  const core = config.services.find((svc) => svc.id === "core-node");
  const fulcrum = config.services.find((svc) => svc.id === "core-fulcrum");
  const coreMissing = core && (!core.binary || !core.datadir || !core.configFile || !core.cookieFile);
  const fulcrumMissing = fulcrum && (!fulcrum.datadir || !fulcrum.configFile || !fulcrum.cookieFile);
  const [proc, mounts] = await Promise.all([
    coreMissing ? readBitcoindProcess() : Promise.resolve(null),
    fulcrumMissing && fulcrum?.containerName ? readDockerMounts(fulcrum.containerName) : Promise.resolve(null),
  ]);
  return applyDiscoveredPaths(config, {
    core: proc ? corePathsFromProcess(proc) : undefined,
    fulcrum: mounts ? fulcrumPathsFromMounts(mounts) : undefined,
  });
}
