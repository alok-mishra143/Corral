import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CorralSettings {
  allowDashboardAccess: boolean;
}

export const DEFAULT_SETTINGS: CorralSettings = {
  allowDashboardAccess: false,
};

export function defaultSettingsPath(): string {
  return join(homedir(), ".corral", "settings.json");
}

export function normalizeSettings(value: unknown): CorralSettings {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    allowDashboardAccess:
      typeof raw.allowDashboardAccess === "boolean"
        ? raw.allowDashboardAccess
        : DEFAULT_SETTINGS.allowDashboardAccess,
  };
}

export async function loadSettings(path: string = defaultSettingsPath()): Promise<CorralSettings> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
    throw err;
  }
  try {
    return normalizeSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  settings: CorralSettings,
  path: string = defaultSettingsPath(),
): Promise<CorralSettings> {
  const normalized = normalizeSettings(settings);
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return normalized;
}