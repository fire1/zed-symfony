import * as fs from "fs";
import * as path from "path";

export interface Psr4Mapping {
  namespace: string;
  directory: string;
}

const DEPENDENCY_SEGMENTS = new Set(["vendor", "node_modules", ".git"]);

export function loadPsr4Mappings(projectRoot: string): Psr4Mapping[] {
  const composerPath = path.join(projectRoot, "composer.json");
  if (!fs.existsSync(composerPath)) {
    return [];
  }

  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, "utf8"));
    const psr4 = composer.autoload?.["psr-4"] ?? {};
    const psr4Dev = composer["autoload-dev"]?.["psr-4"] ?? {};
    const merged = { ...psr4, ...psr4Dev };

    return Object.entries(merged).map(([namespace, dir]) => ({
      namespace: namespace.replace(/\\$/, ""),
      directory: path.join(projectRoot, String(dir).replace(/\\/g, "/")),
    }));
  } catch {
    return [];
  }
}

export function isDependencyPath(filePath: string, projectRoot: string): boolean {
  const rel = path
    .relative(path.resolve(projectRoot), path.resolve(filePath))
    .replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) {
    return false;
  }

  const firstSegment = rel.split("/")[0];
  return DEPENDENCY_SEGMENTS.has(firstSegment);
}

export function fqcnFromFilePath(
  absPath: string,
  projectRoot: string
): string | null {
  const resolvedPath = path.resolve(absPath);
  const resolvedRoot = path.resolve(projectRoot);
  const relPath = path
    .relative(resolvedRoot, resolvedPath)
    .replace(/\\/g, "/");

  if (relPath.startsWith("..") || !relPath.endsWith(".php")) {
    return null;
  }

  for (const mapping of loadPsr4Mappings(resolvedRoot)) {
    const dirRel = path
      .relative(resolvedRoot, mapping.directory)
      .replace(/\\/g, "/");
    const prefix = dirRel === "" ? "" : `${dirRel}/`;

    if (relPath === dirRel || relPath.startsWith(prefix)) {
      const subPath = prefix ? relPath.slice(prefix.length) : relPath;
      const classPath = subPath.replace(/\.php$/, "").replace(/\//g, "\\");
      return classPath
        ? `${mapping.namespace}\\${classPath}`
        : mapping.namespace;
    }
  }

  return null;
}

export function filePathFromFqcn(
  fqcn: string,
  projectRoot: string
): string | null {
  const normalized = fqcn.replace(/^\\/, "");
  const mappings = loadPsr4Mappings(projectRoot);

  for (const mapping of mappings) {
    const prefix = mapping.namespace;
    if (normalized === prefix) {
      return null;
    }
    if (!normalized.startsWith(`${prefix}\\`)) {
      continue;
    }

    const suffix = normalized.slice(prefix.length + 1).replace(/\\/g, "/");
    const filePath = path.join(mapping.directory, `${suffix}.php`);
    return filePath;
  }

  return null;
}

export function resolveClassFile(
  projectRoot: string,
  className: string
): string | null {
  const fromPsr4 = filePathFromFqcn(className, projectRoot);
  if (fromPsr4 && fs.existsSync(fromPsr4)) {
    return fromPsr4;
  }

  return null;
}

export function namespaceFromFqcn(fqcn: string): string | null {
  const normalized = fqcn.replace(/^\\/, "");
  const lastSep = normalized.lastIndexOf("\\");
  if (lastSep <= 0) {
    return null;
  }
  return normalized.slice(0, lastSep);
}

export function basenameFromFqcn(fqcn: string): string {
  const normalized = fqcn.replace(/^\\/, "");
  const lastSep = normalized.lastIndexOf("\\");
  return lastSep >= 0 ? normalized.slice(lastSep + 1) : normalized;
}
