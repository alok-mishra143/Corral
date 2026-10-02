import { parseEvent, type AgentEvent } from "./event.js";

export function normalizeEventInput(input: unknown): AgentEvent | null {
  return parseEvent(input);
}
