import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cache: string | null = null;
const TOKEN_PLACEHOLDER = "var AG_UI_TOKEN = \"\";";

export async function getDashboardHtml(uiToken?: string): Promise<string> {
  if (cache === null) {
    let html: string | null = null;
    try {
      html = await fs.readFile(join(dirname(fileURLToPath(import.meta.url)), "dashboard.html"), "utf8");
    } catch {
    }
    cache =
      html ?? "<!doctype html><title>corral</title><h1>corral</h1><p>dashboard.html missing</p>";
  }
  if (uiToken === undefined) return cache;
  return cache.replace(
    TOKEN_PLACEHOLDER,
    "var AG_UI_TOKEN = " + JSON.stringify(uiToken) + ";",
  );
}