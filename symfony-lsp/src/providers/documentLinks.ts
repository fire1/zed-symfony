import { DocumentLink } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ProjectIndexData } from "../index/projectIndex.js";
import { resolveTwigViaSymfonyCli } from "../index/symfonyCli.js";
import { parseSymfonyStrings, findRepositoryMethodAtPosition } from "../parsers/phpAst.js";
import {
  findMethodLine,
  parseControllerReference,
  pathToFileUri,
  resolveClassFile,
  resolveTwigTemplate,
} from "../utils/paths.js";
import { toLspRange } from "../utils/range.js";

async function resolveTwigPath(
  index: ProjectIndexData,
  templateName: string
): Promise<string | null> {
  const local = resolveTwigTemplate(
    index.projectRoot,
    templateName,
    index.twig
  );
  if (local) {
    return local;
  }

  return resolveTwigViaSymfonyCli(index.projectRoot, templateName);
}

function buildEntityToRepositoryMap(
  index: ProjectIndexData
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [className, entity] of index.entities) {
    map.set(className, entity.repositoryClass);
  }
  return map;
}

function resolveRepositoryMethodDefinition(
  index: ProjectIndexData,
  repositoryClass: string,
  methodName: string
): { uri: string; line: number; character: number } | null {
  const repo = index.repositories.get(repositoryClass);
  if (!repo?.file) {
    return null;
  }
  const line = findMethodLine(repo.file, methodName);
  return { uri: pathToFileUri(repo.file), line, character: 0 };
}

export async function provideDocumentLinks(
  document: TextDocument,
  index: ProjectIndexData
): Promise<DocumentLink[]> {
  const literals = parseSymfonyStrings(document.getText(), document.uri);
  const links: DocumentLink[] = [];
  const entityToRepo = buildEntityToRepositoryMap(index);

  // Scan all lines for repository method calls (document links on method names)
  const lines = document.getText().split("\n");
  const repoMethodPattern =
    /getRepository\(\s*([\w\\]+)::class\s*\)(?:->[\w$]+)*->([\w]+)/g;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    repoMethodPattern.lastIndex = 0;
    let match;
    while ((match = repoMethodPattern.exec(line)) !== null) {
      const entityShort = match[1];
      const methodName = match[2];
      const useMap = new Map<string, string>();
      for (const m of document.getText().matchAll(/^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
        useMap.set(m[2] ?? m[1].split("\\").pop()!, m[1]);
      }
      const entityClass = entityShort.includes("\\")
        ? entityShort
        : useMap.get(entityShort) ?? entityShort;
      const repositoryClass = entityToRepo.get(entityClass);
      if (!repositoryClass) {
        continue;
      }
      const def = resolveRepositoryMethodDefinition(
        index,
        repositoryClass,
        methodName
      );
      if (def) {
        const methodStart = match.index + match[0].lastIndexOf(methodName);
        links.push({
          range: toLspRange({
            startLine: lineNum,
            startCharacter: methodStart,
            endLine: lineNum,
            endCharacter: methodStart + methodName.length,
          }),
          target: def.uri,
          tooltip: `${repositoryClass}::${methodName}()`,
        });
      }
    }
  }

  for (const literal of literals) {
    let target: string | null = null;
    let tooltip: string | undefined;

    switch (literal.kind) {
      case "twig_template": {
        const resolved = await resolveTwigPath(index, literal.value);
        if (resolved) {
          target = pathToFileUri(resolved);
          tooltip = resolved;
        }
        break;
      }
      case "route_name": {
        const route = index.routes.get(literal.value);
        if (route?.controller) {
          const ref = parseControllerReference(route.controller);
          if (ref) {
            const file = resolveClassFile(index.projectRoot, ref.className);
            if (file) {
              target = pathToFileUri(file);
              tooltip = `${route.path} → ${route.controller}`;
            }
          }
        }
        break;
      }
      case "service_id": {
        const service = index.services.get(literal.value);
        if (service?.class) {
          const file =
            service.file ??
            resolveClassFile(index.projectRoot, service.class);
          if (file) {
            target = pathToFileUri(file);
            tooltip = `${literal.value} → ${service.class}`;
          }
        }
        break;
      }
      case "entity_class": {
        const entity = index.entities.get(literal.entityClass ?? literal.value);
        if (entity?.file) {
          target = pathToFileUri(entity.file);
          tooltip = entity.className;
        } else {
          const file = resolveClassFile(
            index.projectRoot,
            literal.entityClass ?? literal.value
          );
          if (file) {
            target = pathToFileUri(file);
          }
        }
        break;
      }
    }

    if (target) {
      links.push({
        range: toLspRange(literal.range),
        target,
        tooltip,
      });
    }
  }

  return links;
}

export async function resolveDefinition(
  document: TextDocument,
  index: ProjectIndexData,
  line: number,
  character: number
): Promise<{ uri: string; line: number; character: number } | null> {
  const entityToRepo = buildEntityToRepositoryMap(index);
  const repoMethod = findRepositoryMethodAtPosition(
    document.getText(),
    line,
    character,
    entityToRepo
  );
  if (repoMethod) {
    const def = resolveRepositoryMethodDefinition(
      index,
      repoMethod.repositoryClass,
      repoMethod.methodName
    );
    if (def) {
      return def;
    }
  }

  const literals = parseSymfonyStrings(document.getText(), document.uri);

  for (const literal of literals) {
    const { range } = literal;
    if (
      line >= range.startLine &&
      line <= range.endLine &&
      character >= range.startCharacter &&
      character <= range.endCharacter
    ) {
      switch (literal.kind) {
        case "twig_template": {
          const resolved = await resolveTwigPath(index, literal.value);
          if (resolved) {
            return { uri: pathToFileUri(resolved), line: 0, character: 0 };
          }
          break;
        }
        case "route_name": {
          const route = index.routes.get(literal.value);
          if (route?.controller) {
            const ref = parseControllerReference(route.controller);
            if (ref) {
              const file = resolveClassFile(index.projectRoot, ref.className);
              if (file) {
                return {
                  uri: pathToFileUri(file),
                  line: findMethodLine(file, ref.method),
                  character: 0,
                };
              }
            }
          }
          break;
        }
        case "service_id": {
          const service = index.services.get(literal.value);
          if (service?.class) {
            const file =
              service.file ??
              resolveClassFile(index.projectRoot, service.class);
            if (file) {
              return { uri: pathToFileUri(file), line: 0, character: 0 };
            }
          }
          break;
        }
        case "entity_class": {
          const entity = index.entities.get(literal.entityClass ?? literal.value);
          const file =
            entity?.file ??
            resolveClassFile(
              index.projectRoot,
              literal.entityClass ?? literal.value
            );
          if (file) {
            return { uri: pathToFileUri(file), line: 0, character: 0 };
          }
          break;
        }
      }
    }
  }

  return null;
}
