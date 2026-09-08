import { readPeerRegistry } from "./claudeDir.ts";
import { listDefinedAgents } from "./parsers/agents.ts";
import type { PeerRegistrySnapshot, SessionMeta } from "../src/types.ts";

/**
 * The live peer registry plus the agent types this machine defines — both disk
 * state outside any transcript's cache key, so they are read per request and
 * handed to the (pure) graph computation, never read from inside it.
 *
 * Shared by the HTTP API and the MCP server: `readSessionDetail` is only "the
 * single assembly point" if the input that shape depends on is assembled once
 * too.
 */
export function peerRegistry(index: SessionMeta[]): PeerRegistrySnapshot {
  const snap = readPeerRegistry();
  snap.knownAgentTypes = listDefinedAgents(index).map((a) => a.name);
  return snap;
}
