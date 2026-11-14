/** Operator-edited locations for the dual-chain stack. Secrets stay in the files these paths point at. */

export const STACK_SERVICE_IDS = [
  "core-node",
  "core-fulcrum",
  "knots-node",
  "knots-fulcrum",
  "knots-link",
] as const;

export type StackServiceId = (typeof STACK_SERVICE_IDS)[number];

export type StackFileLink = {
  label: string;
  path: string;
};

export type StackService = {
  id: StackServiceId;
  label: string;
  /** local services can be started from Scoop. remote services are observed only. */
  control: "local" | "remote";
  /** RPC URL or Electrum URL used by the health probe. */
  endpoint: string;
  binary: string;
  datadir: string;
  configFile: string;
  cookieFile: string;
  /** Optional RPC basic auth. Stays in the local stack file, never in git. */
  rpcUser: string;
  rpcPassword: string;
  containerName: string;
  image: string;
  /** Docker publish spec, host side first: 127.0.0.1:50111:50111 or 0.0.0.0:50111:50111 for LAN */
  publish: string;
  files: StackFileLink[];
  script: string;
  identityFile: string;
  logFile: string;
  startosHost: string;
  /**
   * One shell line run by scoop.cmd / scripts/scoop.sh on this PC.
   * The web UI does not execute it. Typical value is an ssh command.
   */
  remoteStart: string;
};

export type StackExplorers = {
  /** Base URL for Core-chain tx links (default https://mempool.space). */
  core: string;
  /** Base URL for Knots-chain tx links (default https://mempool.guide). */
  knots: string;
};

export type StackConfig = {
  services: StackService[];
  explorers: StackExplorers;
};

export type StackState = "up" | "down" | "unset";

export type StackStatusRow = {
  id: StackServiceId;
  label: string;
  control: "local" | "remote";
  state: StackState;
  endpoint: string;
  height: number | null;
  headers: number | null;
  /** Node verification progress, 0–1. Fulcrum leaves this empty; the page compares tips. */
  progress: number | null;
  detail: string;
  configFile: string;
  datadir: string;
  files: StackFileLink[];
};

export function emptyService(id: StackServiceId, label: string, control: "local" | "remote"): StackService {
  return {
    id,
    label,
    control,
    endpoint: "",
    binary: "",
    datadir: "",
    configFile: "",
    cookieFile: "",
    rpcUser: "",
    rpcPassword: "",
    containerName: "",
    image: "",
    publish: "",
    files: [],
    script: "",
    identityFile: "",
    logFile: "",
    startosHost: "",
    remoteStart: "",
  };
}
