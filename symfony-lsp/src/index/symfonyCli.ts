import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SymfonyCliResult {
  stdout: string;
  stderr: string;
}

export async function runSymfonyCommand(
  projectRoot: string,
  args: string[],
  timeoutMs = 30_000
): Promise<SymfonyCliResult | null> {
  const consolePath = path.join(projectRoot, "bin", "console");
  if (!fs.existsSync(consolePath)) {
    return null;
  }

  const php = process.env.PHP_PATH ?? "php";

  try {
    const { stdout, stderr } = await execFileAsync(php, [consolePath, ...args], {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        APP_ENV: process.env.APP_ENV ?? "dev",
        APP_DEBUG: process.env.APP_DEBUG ?? "1",
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch {
    return null;
  }
}

export function findContainerXml(projectRoot: string): string | null {
  const cacheDir = path.join(projectRoot, "var", "cache", "dev");
  if (!fs.existsSync(cacheDir)) {
    return null;
  }

  const entries = fs.readdirSync(cacheDir);
  const containerFile = entries.find(
    (name) => name.endsWith("Container.xml") || name.endsWith("DebugContainer.xml")
  );

  if (!containerFile) {
    return null;
  }

  return path.join(cacheDir, containerFile);
}

export function getCacheMtime(projectRoot: string): number {
  const cacheDir = path.join(projectRoot, "var", "cache", "dev");
  if (!fs.existsSync(cacheDir)) {
    return 0;
  }

  let latest = 0;
  const stack = [cacheDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          if (mtime > latest) {
            latest = mtime;
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return latest;
}

export function getConfigMtime(projectRoot: string): number {
  const dirs = [
    path.join(projectRoot, "config"),
    path.join(projectRoot, "src", "Entity"),
    path.join(projectRoot, "templates"),
  ];

  let latest = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          try {
            const mtime = fs.statSync(full).mtimeMs;
            if (mtime > latest) {
              latest = mtime;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
  return latest;
}

/** Resolve a template using Symfony's own Twig loader (most accurate fallback). */
export async function resolveTwigViaSymfonyCli(
  projectRoot: string,
  templateName: string
): Promise<string | null> {
  const result = await runSymfonyCommand(projectRoot, [
    "debug:twig",
    templateName,
    "--format=json",
  ]);

  if (!result?.stdout) {
    return null;
  }

  try {
    const data = JSON.parse(result.stdout);
    const matched = data.matched_file;
    if (
      typeof matched !== "string" ||
      matched.includes("not found") ||
      matched.includes("Template name")
    ) {
      return null;
    }

    return path.isAbsolute(matched)
      ? matched
      : path.join(projectRoot, matched);
  } catch {
    return null;
  }
}
