import * as fs from "fs";
import * as path from "path";

export interface PhpactorConfigResult {
  path: string;
  created: boolean;
  updated: boolean;
}

const DEFAULT_EXCLUDE_PATTERNS = [
  "/vendor/**/Tests/**/*",
  "/vendor/**/tests/**/*",
  "/var/cache/**/*",
  "/vendor/composer/**/*",
];

const ensuredProjects = new Set<string>();

let onConfigChanged: ((result: PhpactorConfigResult) => void) | null = null;

export function setPhpactorConfigChangeHandler(
  handler: (result: PhpactorConfigResult) => void
): void {
  onConfigChanged = handler;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Add keys from `defaults` only where `target` has no value yet. */
export function mergeMissingConfig(
  target: JsonRecord,
  defaults: JsonRecord
): boolean {
  let changed = false;

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) {
      target[key] = value;
      changed = true;
      continue;
    }

    const existing = target[key];
    if (isRecord(value) && isRecord(existing)) {
      if (mergeMissingConfig(existing, value)) {
        changed = true;
      }
    }
  }

  return changed;
}

export function findSymfonyContainerXml(projectRoot: string): string | null {
  const cacheDir = path.join(projectRoot, "var", "cache", "dev");
  if (!fs.existsSync(cacheDir)) {
    return null;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(cacheDir);
  } catch {
    return null;
  }

  const containerFiles = entries.filter((name) => name.endsWith("Container.xml"));
  if (containerFiles.length === 0) {
    return null;
  }

  const preferred =
    containerFiles.find((name) => name.includes("Debug")) ?? containerFiles[0];

  return path.join("var", "cache", "dev", preferred);
}

export function recommendedPhpactorConfig(
  projectRoot: string
): JsonRecord {
  const config: JsonRecord = {
    $schema: "/phpactor.schema.json",
    "symfony.enabled": true,
    "indexer.exclude_patterns": DEFAULT_EXCLUDE_PATTERNS,
  };

  const xmlPath = findSymfonyContainerXml(projectRoot);
  if (xmlPath) {
    config["symfony.xml_path"] = xmlPath;
  }

  return config;
}

export function isAutoPhpactorConfigEnabled(): boolean {
  const flag = process.env.SYMFONY_LSP_AUTO_PHPACTOR_CONFIG?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
    return false;
  }
  return true;
}

/**
 * Create or merge recommended Phpactor settings for a Symfony project.
 * Never overwrites keys the user already configured.
 */
export function ensurePhpactorConfig(
  projectRoot: string
): PhpactorConfigResult | null {
  if (!isAutoPhpactorConfigEnabled()) {
    return null;
  }

  if (ensuredProjects.has(projectRoot)) {
    return null;
  }
  ensuredProjects.add(projectRoot);

  const configPath = path.join(projectRoot, ".phpactor.json");
  const recommended = recommendedPhpactorConfig(projectRoot);

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(recommended, null, 2)}\n`,
      "utf8"
    );
    const result = { path: configPath, created: true, updated: false };
    onConfigChanged?.(result);
    return result;
  }

  try {
    const existing = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!isRecord(existing)) {
      return null;
    }

    const merged = { ...existing };
    const changed = mergeMissingConfig(merged, recommended);
    if (!changed) {
      return null;
    }

    fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    const result = { path: configPath, created: false, updated: true };
    onConfigChanged?.(result);
    return result;
  } catch {
    return null;
  }
}

/** @internal test helper */
export function resetPhpactorConfigCache(): void {
  ensuredProjects.clear();
}
