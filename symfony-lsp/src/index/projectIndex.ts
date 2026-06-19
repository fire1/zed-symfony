import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { runSymfonyCommand } from "./symfonyCli.js";
import { expandSymfonyPath, resolveClassFile } from "../utils/paths.js";
import { ensurePhpactorConfig } from "../utils/phpactorConfig.js";
import {
  extractRepositoryMethods,
  indexDoctrineMappingsFromYaml,
  indexEntityFile,
  indexRepositoryFiles,
} from "./doctrineIndex.js";

export interface TwigIndex {
  loaderPaths: string[];
  templates: string[];
  /** Maps Twig namespace (e.g. "Statistics") to absolute view directory paths. */
  namespaces: Map<string, string[]>;
}

export interface RouteInfo {
  name: string;
  path: string;
  controller: string;
  pathParams: string[];
}

export interface ServiceInfo {
  id: string;
  class: string;
  file?: string;
}

export interface EntityInfo {
  className: string;
  file: string;
  repositoryClass: string;
  repositoryFile?: string;
}

export interface RepositoryInfo {
  className: string;
  file: string;
  methods: string[];
  entityClass?: string;
}

export interface ProjectIndexData {
  projectRoot: string;
  twig: TwigIndex;
  routes: Map<string, RouteInfo>;
  services: Map<string, ServiceInfo>;
  entities: Map<string, EntityInfo>;
  repositories: Map<string, RepositoryInfo>;
  indexedAt: number;
}

export class ProjectIndex {
  private cache = new Map<string, ProjectIndexData>();
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async get(projectRoot: string): Promise<ProjectIndexData> {
    const existing = this.cache.get(projectRoot);
    if (existing && Date.now() - existing.indexedAt < 60_000) {
      return existing;
    }

    const data = await this.build(projectRoot);
    this.cache.set(projectRoot, data);
    return data;
  }

  invalidate(projectRoot: string): void {
    this.cache.delete(projectRoot);
    const timer = this.refreshTimers.get(projectRoot);
    if (timer) {
      clearTimeout(timer);
    }
    this.refreshTimers.set(
      projectRoot,
      setTimeout(() => {
        this.cache.delete(projectRoot);
        this.refreshTimers.delete(projectRoot);
      }, 500)
    );
  }

  private async build(projectRoot: string): Promise<ProjectIndexData> {
    ensurePhpactorConfig(projectRoot);

    const [twig, routes, services, { entities, repositories }] =
      await Promise.all([
        this.indexTwig(projectRoot),
        this.indexRoutes(projectRoot),
        this.indexServices(projectRoot),
        this.indexDoctrine(projectRoot),
      ]);

    return {
      projectRoot,
      twig,
      routes,
      services,
      entities,
      repositories,
      indexedAt: Date.now(),
    };
  }

  private async indexTwig(projectRoot: string): Promise<TwigIndex> {
    const loaderPaths: string[] = [];
    const templates: string[] = [];
    const namespaces = new Map<string, string[]>();

    const addNamespace = (namespace: string, dirPath: string) => {
      const ns = namespace.replace(/^@/, "").replace(/Bundle$/, "");
      if (!ns || ns === "(None)") {
        loaderPaths.push(dirPath);
        return;
      }
      const existing = namespaces.get(ns) ?? [];
      if (!existing.includes(dirPath)) {
        existing.push(dirPath);
        namespaces.set(ns, existing);
      }
    };

    const result = await runSymfonyCommand(projectRoot, [
      "debug:twig",
      "--format=json",
    ]);

    if (result?.stdout) {
      try {
        const data = JSON.parse(result.stdout);
        if (data.loader_paths && typeof data.loader_paths === "object") {
          for (const [ns, paths] of Object.entries(data.loader_paths)) {
            const pathList = Array.isArray(paths) ? paths : [paths];
            for (const p of pathList) {
              if (typeof p !== "string") {
                continue;
              }
              const abs = expandSymfonyPath(p, projectRoot);
              if (ns === "(None)" || ns === "@(None)") {
                loaderPaths.push(abs);
              } else {
                addNamespace(ns, abs);
              }
            }
          }
        }
        if (Array.isArray(data.paths)) {
          for (const entry of data.paths) {
            if (typeof entry === "string") {
              templates.push(entry);
            } else if (entry?.name) {
              templates.push(entry.name);
            }
          }
        }
      } catch {
        // fall through to static indexing
      }
    }

    if (loaderPaths.length === 0) {
      loaderPaths.push(
        path.join(projectRoot, "templates"),
        path.join(projectRoot, "templates", "bundles")
      );
    }

    const twigConfigFiles = [
      path.join(projectRoot, "config", "packages", "twig.yaml"),
      path.join(projectRoot, "config", "packages", "twig.yml"),
    ];

    for (const twigYaml of twigConfigFiles) {
      if (!fs.existsSync(twigYaml)) {
        continue;
      }
      try {
        const doc = parseYaml(fs.readFileSync(twigYaml, "utf8"));
        const paths = doc?.twig?.paths ?? doc?.paths;
        if (paths && typeof paths === "object") {
          for (const [dirPath, namespace] of Object.entries(paths)) {
            const abs = expandSymfonyPath(dirPath, projectRoot);
            if (namespace && typeof namespace === "string") {
              addNamespace(namespace, abs);
            } else {
              loaderPaths.push(abs);
            }
          }
        }
        const defaultPath = doc?.twig?.default_path;
        if (defaultPath) {
          loaderPaths.push(expandSymfonyPath(defaultPath, projectRoot));
        }
      } catch {
        // ignore
      }
    }

    // Domain / bundle structure: src/Statistics/Resources/views → @Statistics
    const bundleViewDirs = await fg("src/**/Resources/views", {
      cwd: projectRoot,
      onlyDirectories: true,
      ignore: ["vendor/**", "var/**", "node_modules/**"],
    });

    for (const relDir of bundleViewDirs) {
      const absDir = path.join(projectRoot, relDir);
      const match = relDir.match(/^src\/([^/]+)\/Resources\/views$/);
      if (match) {
        const segment = match[1].replace(/Bundle$/, "");
        addNamespace(segment, absDir);
      }
    }

    // Build logical template names (@Statistics/foo.twig) for completion
    for (const [namespace, roots] of namespaces) {
      for (const viewsRoot of roots) {
        if (!fs.existsSync(viewsRoot)) {
          continue;
        }
        const files = await fg("**/*.twig", {
          cwd: viewsRoot,
          onlyFiles: true,
        });
        for (const file of files) {
          templates.push(`@${namespace}/${file.replace(/\\/g, "/")}`);
        }
      }
    }

    const templateFiles = await fg("**/*.twig", {
      cwd: projectRoot,
      ignore: ["vendor/**", "var/**", "node_modules/**"],
    });

    for (const file of templateFiles) {
      templates.push(file.replace(/\\/g, "/"));
    }

    return {
      loaderPaths: [...new Set(loaderPaths)],
      templates: [...new Set(templates)],
      namespaces,
    };
  }

  private async indexRoutes(projectRoot: string): Promise<Map<string, RouteInfo>> {
    const routes = new Map<string, RouteInfo>();

    const result = await runSymfonyCommand(projectRoot, [
      "debug:router",
      "--format=json",
    ]);

    if (result?.stdout) {
      try {
        const data = JSON.parse(result.stdout);
        for (const [name, info] of Object.entries(data)) {
          if (name.startsWith("_")) {
            continue;
          }
          const route = info as {
            path?: string;
            defaults?: { _controller?: string };
          };
          const controller = route.defaults?._controller ?? "";
          const pathParams = (route.path ?? "").match(/\{(\w+)\}/g)?.map((p) =>
            p.slice(1, -1)
          ) ?? [];
          routes.set(name, {
            name,
            path: route.path ?? "",
            controller,
            pathParams,
          });
        }
        return routes;
      } catch {
        // fall through
      }
    }

    // Fallback: scan PHP attributes
    const controllerFiles = await fg("src/**/*.php", {
      cwd: projectRoot,
      ignore: ["vendor/**"],
    });

    for (const file of controllerFiles) {
      const content = fs.readFileSync(path.join(projectRoot, file), "utf8");
      const routeAttrRegex =
        /#\[Route\([^)]*name:\s*['"]([^'"]+)['"][^)]*\)[^\n]*\n\s*public\s+function\s+(\w+)/gs;
      let match;
      while ((match = routeAttrRegex.exec(content)) !== null) {
        const classMatch = content.match(/namespace\s+([\w\\]+)/);
        const classNameMatch = content.match(/class\s+(\w+)/);
        if (classMatch && classNameMatch) {
          const controller = `${classMatch[1]}\\${classNameMatch[1]}::${match[2]}`;
          routes.set(match[1], {
            name: match[1],
            path: "",
            controller,
            pathParams: [],
          });
        }
      }
    }

    return routes;
  }

  private async indexServices(
    projectRoot: string
  ): Promise<Map<string, ServiceInfo>> {
    const services = new Map<string, ServiceInfo>();

    const result = await runSymfonyCommand(projectRoot, [
      "debug:container",
      "--format=json",
      "--show-private",
    ]);

    if (result?.stdout) {
      try {
        const data = JSON.parse(result.stdout);
        for (const [id, info] of Object.entries(data)) {
          const svc = info as { class?: string; file?: string };
          if (svc.class) {
            services.set(id, {
              id,
              class: svc.class,
              file: svc.file,
            });
          }
        }
        return services;
      } catch {
        // fall through
      }
    }

    // Fallback: parse container XML
    const { findContainerXml } = await import("./symfonyCli.js");
    const xmlPath = findContainerXml(projectRoot);
    if (xmlPath && fs.existsSync(xmlPath)) {
      const xml = fs.readFileSync(xmlPath, "utf8");
      const serviceRegex =
        /<service\s+id="([^"]+)"[^>]*class="([^"]+)"[^>]*\/?>/g;
      let match;
      while ((match = serviceRegex.exec(xml)) !== null) {
        services.set(match[1], { id: match[1], class: match[2] });
      }
      const serviceRegex2 =
        /<service\s+id="([^"]+)"[^>]*>\s*<tag[^>]*\/>?\s*<\/service>/g;
      // Also match services with class attribute in different order
      const altRegex =
        /<service\s+([^>]+)\/?>/g;
      while ((match = altRegex.exec(xml)) !== null) {
        const attrs = match[1];
        const idMatch = attrs.match(/id="([^"]+)"/);
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (idMatch && classMatch) {
          services.set(idMatch[1], {
            id: idMatch[1],
            class: classMatch[1],
          });
        }
      }
    }

    return services;
  }

  private async indexDoctrine(projectRoot: string): Promise<{
    entities: Map<string, EntityInfo>;
    repositories: Map<string, RepositoryInfo>;
  }> {
    const entities = new Map<string, EntityInfo>();
    const repositories = new Map<string, RepositoryInfo>();

    const yamlEntityRepos = await indexDoctrineMappingsFromYaml(projectRoot);
    const scannedRepos = await indexRepositoryFiles(projectRoot);

    // Index all PHP files with ORM\Entity (not only src/**/Entity/**)
    const entityFiles = await fg("src/**/*.php", {
      cwd: projectRoot,
      ignore: ["vendor/**", "**/*Repository.php"],
    });

    for (const relPath of entityFiles) {
      const file = path.join(projectRoot, relPath);
      const content = fs.readFileSync(file, "utf8");
      const indexed = indexEntityFile(projectRoot, file, content);
      if (!indexed) {
        continue;
      }

      let { className, repositoryClass } = indexed;

      if (yamlEntityRepos.has(className)) {
        repositoryClass = yamlEntityRepos.get(className)!;
      }

      // Link entity from repository scan (ServiceEntityRepository<Entity>)
      for (const repo of scannedRepos.values()) {
        if (repo.entityClass === className) {
          repositoryClass = repo.className;
          break;
        }
      }

      const entity: EntityInfo = { className, file, repositoryClass };
      entities.set(className, entity);

      let repoInfo = scannedRepos.get(repositoryClass);
      let repoFile = repoInfo?.file ?? resolveClassFile(projectRoot, repositoryClass);

      if (repoFile && !repoInfo) {
        const repoContent = fs.readFileSync(repoFile, "utf8");
        repoInfo = {
          className: repositoryClass,
          file: repoFile,
          methods: extractRepositoryMethods(repoContent),
          entityClass: className,
        };
      }

      if (repoFile && repoInfo) {
        entity.repositoryFile = repoFile;
        repositories.set(repositoryClass, {
          className: repositoryClass,
          file: repoFile,
          methods: repoInfo.methods,
          entityClass: className,
        });
      }
    }

    // Register repositories not linked to entities yet
    for (const repo of scannedRepos.values()) {
      if (!repositories.has(repo.className)) {
        repositories.set(repo.className, repo);
      }
      if (repo.entityClass && !entities.has(repo.entityClass)) {
        entities.set(repo.entityClass, {
          className: repo.entityClass,
          file: resolveClassFile(projectRoot, repo.entityClass) ?? "",
          repositoryClass: repo.className,
          repositoryFile: repo.file,
        });
      }
    }

    return { entities, repositories };
  }
}

export const projectIndex = new ProjectIndex();
