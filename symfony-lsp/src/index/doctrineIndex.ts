import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { resolveClassFile } from "../utils/paths.js";

export function extractRepositoryMethods(content: string): string[] {
  return [...content.matchAll(/function\s+(\w+)\s*\(/g)]
    .map((m) => m[1])
    .filter(
      (m) =>
        !m.startsWith("__") &&
        m !== "getEntityClass" &&
        m !== "getClassName"
    );
}

export function resolveRepositoryClassName(
  entityNamespace: string,
  entityShortName: string,
  content: string,
  projectRoot: string
): string {
  const repoAttrMatch = content.match(
    /repositoryClass:\s*([\w\\]+(?:::class)?|'[^']+'|"[^"]+")/
  );
  if (repoAttrMatch) {
    let repositoryClass = repoAttrMatch[1]
      .replace(/::class$/, "")
      .replace(/^['"]|['"]$/g, "");
    if (!repositoryClass.includes("\\")) {
      const useMatch = content.match(
        new RegExp(
          `^use\\s+([\\w\\\\]+(?:\\\\${repositoryClass}))\\s*;`,
          "m"
        )
      );
      if (useMatch) {
        repositoryClass = useMatch[1];
      } else {
        repositoryClass = `${entityNamespace}\\${repositoryClass}`;
      }
    }
    return repositoryClass;
  }

  // Symfony convention: App\Foo\Entity\Bar → App\Foo\Repository\BarRepository
  if (entityNamespace.endsWith("\\Entity")) {
    const repoNamespace = entityNamespace.replace(/\\Entity$/, "\\Repository");
    const conventional = `${repoNamespace}\\${entityShortName}Repository`;
    if (resolveClassFile(projectRoot, conventional)) {
      return conventional;
    }
  }

  // Same namespace as entity: App\Foo\Bar → App\Foo\BarRepository
  const sameNs = `${entityNamespace}\\${entityShortName}Repository`;
  if (resolveClassFile(projectRoot, sameNs)) {
    return sameNs;
  }

  // Parent namespace: App\WorkTackle\Entity\X → App\WorkTackle\XRepository
  const parentNs = entityNamespace.replace(/\\[^\\]+$/, "");
  const parentCandidate = `${parentNs}\\${entityShortName}Repository`;
  if (resolveClassFile(projectRoot, parentCandidate)) {
    return parentCandidate;
  }

  return sameNs;
}

export function indexEntityFile(
  projectRoot: string,
  file: string,
  content: string
): { className: string; repositoryClass: string } | null {
  if (!/#\[ORM\\Entity|@ORM\\Entity/.test(content)) {
    return null;
  }

  const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
  const classMatch = content.match(/(?:class|interface)\s+(\w+)/);
  if (!namespaceMatch || !classMatch) {
    return null;
  }

  const className = `${namespaceMatch[1]}\\${classMatch[1]}`;
  const repositoryClass = resolveRepositoryClassName(
    namespaceMatch[1],
    classMatch[1],
    content,
    projectRoot
  );

  return { className, repositoryClass };
}

export async function indexDoctrineMappingsFromYaml(
  projectRoot: string
): Promise<Map<string, string>> {
  const entityToRepo = new Map<string, string>();

  const yamlFiles = await fg(
    ["config/packages/doctrine.{yaml,yml}", "config/doctrine/**/*.{yaml,yml}"],
    { cwd: projectRoot, absolute: true }
  );

  for (const yamlFile of yamlFiles) {
    try {
      const doc = parseYaml(fs.readFileSync(yamlFile, "utf8"));
      collectYamlMappings(doc, entityToRepo);
    } catch {
      // ignore
    }
  }

  return entityToRepo;
}

function collectYamlMappings(node: unknown, entityToRepo: Map<string, string>): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectYamlMappings(item, entityToRepo);
    }
    return;
  }

  const record = node as Record<string, unknown>;

  // doctrine.orm.entity_manager.mappings.*.type: attribute
  // entity entry with repositoryClass
  if (typeof record.repositoryClass === "string") {
    // handled at entity level in parent key
  }

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      if (typeof entry.repositoryClass === "string" && key.includes("\\")) {
        entityToRepo.set(key, entry.repositoryClass.replace(/::class$/, ""));
      } else if (
        typeof entry.repositoryClass === "string" &&
        typeof entry.class === "string"
      ) {
        entityToRepo.set(
          entry.class as string,
          (entry.repositoryClass as string).replace(/::class$/, "")
        );
      }
      collectYamlMappings(value, entityToRepo);
    }
  }
}

export async function indexRepositoryFiles(
  projectRoot: string
): Promise<Map<string, { className: string; file: string; methods: string[]; entityClass?: string }>> {
  const repositories = new Map<
    string,
    { className: string; file: string; methods: string[]; entityClass?: string }
  >();

  const repoFiles = await fg("src/**/*Repository.php", {
    cwd: projectRoot,
    ignore: ["vendor/**"],
  });

  for (const relPath of repoFiles) {
    const file = path.join(projectRoot, relPath);
    const content = fs.readFileSync(file, "utf8");
    const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
    const classMatch = content.match(/class\s+(\w+Repository)/);
    if (!namespaceMatch || !classMatch) {
      continue;
    }

    const className = `${namespaceMatch[1]}\\${classMatch[1]}`;
    const methods = extractRepositoryMethods(content);

    let entityClass: string | undefined;
    const entityTypeMatch = content.match(
      /extends\s+ServiceEntityRepository<([^>]+)>/ 
    );
    if (entityTypeMatch) {
      entityClass = entityTypeMatch[1].trim().replace(/::class$/, "");
    } else {
      const constructorMatch = content.match(
        /parent::__construct\(\$registry,\s*([\w\\]+)::class/
      );
      if (constructorMatch) {
        entityClass = constructorMatch[1];
      }
    }

    repositories.set(className, {
      className,
      file,
      methods,
      entityClass,
    });
  }

  return repositories;
}
