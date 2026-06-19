import * as fs from "fs";
import * as path from "path";
import { TwigIndex } from "../index/projectIndex.js";

export function fileUriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

export function pathToFileUri(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  if (process.platform === "win32" && !normalized.startsWith("/")) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

export function findSymfonyProjectRoot(startPath: string): string | null {
  let current = path.isAbsolute(startPath)
    ? startPath
    : path.resolve(startPath);

  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  while (true) {
    const composerPath = path.join(current, "composer.json");
    if (fs.existsSync(composerPath)) {
      try {
        const composer = JSON.parse(fs.readFileSync(composerPath, "utf8"));
        const require = {
          ...composer.require,
          ...composer["require-dev"],
        };
        const hasSymfony = Object.keys(require ?? {}).some((pkg) =>
          pkg.startsWith("symfony/")
        );
        if (hasSymfony) {
          return current;
        }
      } catch {
        // ignore invalid composer.json
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isSymfonyProjectRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return findSymfonyProjectRoot(resolved) === resolved;
}

/** Discover Symfony project roots under a workspace folder (skips vendor/node_modules). */
export function findSymfonyProjectRootsUnder(
  startDir: string,
  maxDepth = 4
): string[] {
  const roots = new Set<string>();
  const resolvedStart = path.resolve(startDir);

  if (isSymfonyProjectRoot(resolvedStart)) {
    roots.add(resolvedStart);
    return [...roots];
  }

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (
        entry.name === "vendor" ||
        entry.name === "node_modules" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const subDir = path.join(dir, entry.name);
      if (isSymfonyProjectRoot(subDir)) {
        roots.add(path.resolve(subDir));
        continue;
      }

      walk(subDir, depth + 1);
    }
  }

  walk(resolvedStart, 1);
  return [...roots];
}

export function resolveClassFile(
  projectRoot: string,
  className: string
): string | null {
  const relative = className.replace(/^\\/, "").replace(/\\/g, "/") + ".php";

  const candidates = [
    path.join(projectRoot, "src", relative.replace(/^App\//, "App/")),
    path.join(projectRoot, "src", relative),
    path.join(projectRoot, relative),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const composerPath = path.join(projectRoot, "composer.json");
  if (!fs.existsSync(composerPath)) {
    return null;
  }

  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, "utf8"));
    const psr4 = composer.autoload?.["psr-4"] ?? {};
    const psr4Dev = composer.autoload?.["psr-4-dev"] ?? {};
    const mappings = { ...psr4, ...psr4Dev };

    for (const [prefix, dir] of Object.entries(mappings)) {
      const nsPrefix = prefix.replace(/\\$/, "");
      if (className.startsWith(nsPrefix)) {
        const suffix = className
          .slice(nsPrefix.length)
          .replace(/^\\/, "")
          .replace(/\\/g, "/");
        const baseDir = path.join(projectRoot, dir as string);
        const filePath = path.join(baseDir, `${suffix}.php`);
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export function expandSymfonyPath(value: string, projectRoot: string): string {
  const expanded = value
    .replace(/%kernel\.project_dir%/g, projectRoot)
    .replace(/%kernel\.root_dir%/g, path.join(projectRoot, "src"))
    .trim();

  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.join(projectRoot, expanded);
}

/** Parse `@Statistics/personal/user.twig` into namespace + relative path. */
export function parseTwigTemplateName(templateName: string): {
  namespace: string | null;
  relativePath: string;
} {
  const normalized = templateName.replace(/\\/g, "/").trim();

  if (normalized.startsWith("@")) {
    const slash = normalized.indexOf("/");
    if (slash > 1) {
      return {
        namespace: normalized.slice(1, slash),
        relativePath: normalized.slice(slash + 1),
      };
    }
    return { namespace: normalized.slice(1), relativePath: "" };
  }

  return { namespace: null, relativePath: normalized };
}

export function isTwigTemplateReference(value: string): boolean {
  return value.endsWith(".twig") || value.startsWith("@");
}

function tryFileCandidates(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveTwigTemplate(
  projectRoot: string,
  templateName: string,
  twig: Pick<TwigIndex, "loaderPaths" | "namespaces">
): string | null {
  const { namespace, relativePath } = parseTwigTemplateName(templateName);

  // @Statistics/personal/user.twig → namespace "Statistics"
  if (namespace) {
    const viewRoots = twig.namespaces.get(namespace) ?? [];

    for (const viewsRoot of viewRoots) {
      const resolved = tryFileCandidates([
        path.join(viewsRoot, relativePath),
        path.join(viewsRoot, "templates", relativePath),
      ]);
      if (resolved) {
        return resolved;
      }
    }

    // Domain bundle convention: src/Statistics/Resources/views/
    const bundleViews = path.join(
      projectRoot,
      "src",
      namespace,
      "Resources",
      "views",
      relativePath
    );
    if (fs.existsSync(bundleViews)) {
      return bundleViews;
    }

    // Vendor bundle: src/StatisticsBundle/Resources/views/ (strip Bundle suffix try)
    if (!namespace.endsWith("Bundle")) {
      const bundleAlt = path.join(
        projectRoot,
        "src",
        `${namespace}Bundle`,
        "Resources",
        "views",
        relativePath
      );
      if (fs.existsSync(bundleAlt)) {
        return bundleAlt;
      }
    }
  }

  // Main namespace (no @ prefix)
  for (const loaderPath of twig.loaderPaths) {
    const absLoader = path.isAbsolute(loaderPath)
      ? loaderPath
      : path.join(projectRoot, loaderPath);

    const resolved = tryFileCandidates([
      path.join(absLoader, relativePath),
      path.join(absLoader, "templates", relativePath),
    ]);
    if (resolved) {
      return resolved;
    }
  }

  const fallbacks = [
    path.join(projectRoot, "templates", relativePath),
    path.join(projectRoot, relativePath),
  ];

  return tryFileCandidates(fallbacks);
}

export function parseControllerReference(
  controller: string
): { className: string; method: string } | null {
  const match = controller.match(/^(.+?)::(\w+)$/);
  if (!match) {
    return null;
  }
  return { className: match[1], method: match[2] };
}

export function findMethodLine(filePath: string, methodName: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const patterns = [
    new RegExp(`function\\s+${methodName}\\s*\\(`),
    new RegExp(`function\\s+${methodName.replace(/Action$/, "")}\\s*\\(`),
  ];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      return i;
    }
  }

  return 0;
}
