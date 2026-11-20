import type { StackServiceId } from "@/lib/stack/types";

export type StartOffer = {
  id: StackServiceId;
  label: string;
  canStart: boolean;
};

const DAILY_START = new Set<StartOffer["id"]>(["core-node", "core-fulcrum"]);

/**
 * Core node and Core Fulcrum when Scoop can start them on this PC.
 * The optional Knots tunnel and remote Knots services stay off this prompt.
 */
export function localServicesToStart(rows: StartOffer[]): StartOffer[] {
  return rows.filter((row) => row.canStart && DAILY_START.has(row.id));
}
