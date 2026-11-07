import { loadStackConfig } from "@/lib/stack/config";
import { resolveExplorerBases, type ExplorerBases } from "@/lib/explorer/urls";

/** Load explorer bases from env + the operator's stack.json. */
export function loadExplorerBases(env: NodeJS.ProcessEnv = process.env): ExplorerBases {
  try {
    return resolveExplorerBases(env, loadStackConfig(undefined, env).explorers);
  } catch {
    return resolveExplorerBases(env, null);
  }
}
