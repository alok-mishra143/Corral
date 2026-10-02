import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeEventInput } from "./normalizer.js";
import type { AgentEvent } from "./event.js";

export function defaultStorePath(): string {
  return join(homedir(), ".corral", "events.jsonl");
}

const MAX_SEEN_IDS = 5000;
const ID_TAIL_BYTES = 64 * 1024;
const FIRST_WINDOW_BYTES = 64 * 1024;

interface TailText {
  text: string;
  truncated: boolean;
}

async function readTailText(filePath: string, maxBytes: number): Promise<TailText> {
  const fh = await fs.open(filePath, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return { text: "", truncated: false };
    const buf = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await fh.read(buf, offset, length - offset, start + offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    return { text: buf.subarray(0, offset).toString("utf8"), truncated: start > 0 };
  } finally {
    await fh.close();
  }
}

export class EventStore {
  private seenIds = new Set<string>();
  private loaded = false;

  constructor(private readonly filePath: string = defaultStorePath()) {}

  get path(): string {
    return this.filePath;
  }

  private remember(id: string): void {
    this.seenIds.add(id);
    if (this.seenIds.size > MAX_SEEN_IDS) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const { text, truncated } = await readTailText(this.filePath, ID_TAIL_BYTES);
      const lines = text.split("\n");
      for (let i = truncated ? 1 : 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { id?: unknown };
          if (typeof obj.id === "string") this.remember(obj.id);
        } catch {
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private async ensureDir(): Promise<void> {
    const dir = this.filePath.slice(0, this.filePath.lastIndexOf("/"));
    if (dir) await fs.mkdir(dir, { recursive: true });
  }

  async append(input: unknown): Promise<AgentEvent | null> {
    const event = normalizeEventInput(input);
    if (!event) return null;
    await this.ensureLoaded();
    if (this.seenIds.has(event.id)) return event; // duplicate: don't write twice
    await this.ensureDir();
    await fs.appendFile(this.filePath, JSON.stringify(event) + "\n", "utf8");
    this.remember(event.id);
    return event;
  }

  async readTail(limit: number, filter?: (event: AgentEvent) => boolean): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    let window = FIRST_WINDOW_BYTES;
    for (;;) {
      let tail: TailText;
      try {
        tail = await readTailText(this.filePath, window);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      out.length = 0;
      const lines = tail.text.split("\n");
      for (let i = lines.length - 1; i >= (tail.truncated ? 1 : 0) && out.length < limit; i--) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        try {
          const event = normalizeEventInput(JSON.parse(line));
          if (event && (!filter || filter(event))) out.push(event);
        } catch {
        }
      }
      if (out.length >= limit || !tail.truncated) break;
      window *= 4;
    }
    out.reverse();
    return out;
  }
}
