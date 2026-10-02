import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function findIntegrationsDir(): Promise<string | null> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const entry = process.argv[1];
  if (entry && !entry.startsWith("node:")) {
    try {
      const abs = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
      candidates.push(join(dirname(abs), "..", "integrations"));
    } catch {
    }
  }
  candidates.push(join(process.cwd(), "integrations"));
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    try {
      const st = await fs.stat(join(c, "opencode", "plugin.ts"));
      if (st.isFile()) return c;
    } catch {
    }
  }
  return null;
}

export function globalOpencodePluginDir(): string {
  return join(homedir(), ".config", "opencode", "plugins");
}


