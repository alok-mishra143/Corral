import { execFile } from "node:child_process";

export interface RunningAgent {
  name: string;
  pid: number;
  command: string;
  cwd?: string;
  ide?: string;
}

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenCode", re: /opencode/i },
];

const IDE_MARKERS: { name: string; re: RegExp }[] = [
  { name: "VS Code", re: /visual studio code\.app|\/code( -oss)?( |$|\/)|\bcode\b.*helper|vscodium/i },
  { name: "Zed", re: /zed\.app|\bzed\b/i },
  { name: "Cursor", re: /cursor\.app|\bcursor\b/i },
  { name: "Windsurf", re: /windsurf\.app|\bwindsurf\b/i },
  { name: "JetBrains", re: /intellij|webstorm|pycharm|goland|phpstorm|clion|rider|android studio/i },
  { name: "Xcode", re: /xcode\.app|\bxcodebuild\b/i },
  { name: "Sublime", re: /sublime text\.app|\bsubl\b/i },
  { name: "Vim", re: /\/vim?\s|^\s*vim?\s/i },
  { name: "Neovim", re: /nvim/i },
  { name: "Terminal", re: /terminal\.app|iterm|ghostty|alacritty|kitty|wezterm|tmux/i },
];

function detectIde(args: string): string | undefined {
  for (const m of IDE_MARKERS) if (m.re.test(args)) return m.name;
  return undefined;
}

const NOISE =
  /corral|grep|ps -axo|crash-handler|crashpad|mcp-server|\/extensions\/|helper|renderer|gpu-process|utility-network|wakatime|codebook|package-version|node($|\s)|\/node /i;

function baseOf(args: string): string {
  const first = args.trim().split(/\s+/)[0] ?? "";
  const seg = first.replace(/\\/g, "/").split("/");
  return seg[seg.length - 1] ?? "";
}

function ps(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,ppid=,comm=,args="], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function scanAgents(): Promise<RunningAgent[]> {
  let out: string;
  try {
    out = await ps();
  } catch {
    return [];
  }
  const agents: RunningAgent[] = [];
  const byPid = new Map<number, { ppid: number; args: string }>();
  const rows: { pid: number; ppid: number; args: string }[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const args = m[4] ?? "";
    byPid.set(pid, { ppid, args });
    rows.push({ pid, ppid, args });
  }
  function parentIde(pid: number): string | undefined {
    let cur = byPid.get(pid)?.ppid;
    for (let i = 0; i < 6 && cur; i++) {
      const p = byPid.get(cur);
      if (!p) break;
      const hit = detectIde(p.args);
      if (hit) return hit;
      cur = p.ppid;
    }
    return undefined;
  }
  for (const { pid, args } of rows) {
    if (NOISE.test(args)) continue;
    const base = baseOf(args).replace(/\.exe$/i, "");
    for (const p of PATTERNS) {
      if (p.re.test(base) || (p.re.test(args) && !/\b(Zed|Cursor|Code|Windsurf)\.app\b/i.test(args))) {
        agents.push({ name: p.name, pid, command: args.slice(0, 300), ide: parentIde(pid) });
        break;
      }
    }
    if (agents.length >= 100) break;
  }
  return agents;
}

