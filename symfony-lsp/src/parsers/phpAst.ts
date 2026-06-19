import { Engine } from "php-parser";

export type SymfonyStringKind =
  | "twig_template"
  | "service_id"
  | "route_name"
  | "entity_class";

export interface SymfonyStringLiteral {
  kind: SymfonyStringKind;
  value: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  /** For getRepository(Entity::class) */
  entityClass?: string;
  /** For chained repository method context */
  repositoryClass?: string;
}

const TWIG_METHODS = new Set([
  "render",
  "renderView",
  "renderBlock",
  "renderForm",
]);

const ROUTE_METHODS = new Set([
  "generateUrl",
  "redirectToRoute",
  "redirect",
  "forward",
]);

const CONTAINER_METHODS = new Set(["get", "has", "getDefinition"]);

const engine = new Engine({
  parser: {
    extractDoc: true,
    suppressErrors: true,
  },
  ast: {
    withPositions: true,
  },
});

function positionFromNode(node: {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
}): SymfonyStringLiteral["range"] | null {
  if (!node.loc) {
    return null;
  }
  return {
    startLine: node.loc.start.line - 1,
    startCharacter: node.loc.start.column,
    endLine: node.loc.end.line - 1,
    endCharacter: node.loc.end.column,
  };
}

function getMethodName(callee: any): string | null {
  if (callee?.kind === "identifier") {
    return callee.name;
  }
  if (callee?.kind === "propertylookup") {
    return callee.offset?.name ?? null;
  }
  return null;
}

function getStringValue(node: any): string | null {
  if (node?.kind === "string") {
    return node.value ?? node.raw?.replace(/^['"]|['"]$/g, "") ?? null;
  }
  return null;
}

function extractUseMap(content: string): Map<string, string> {
  const uses = new Map<string, string>();
  for (const match of content.matchAll(
    /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm
  )) {
    const fqcn = match[1];
    const alias = match[2] ?? fqcn.split("\\").pop()!;
    uses.set(alias, fqcn);
  }
  return uses;
}

function resolveClassName(name: string, useMap: Map<string, string>): string {
  if (name.includes("\\")) {
    return name.startsWith("\\") ? name.slice(1) : name;
  }
  return useMap.get(name) ?? name;
}

function getClassConstEntity(node: any, useMap: Map<string, string>): string | null {
  if (node?.kind === "classconstant") {
    const className = node.what?.name ?? node.class?.name;
    const constName = node.const?.name ?? node.constant?.name;
    if (className && constName === "class") {
      return resolveClassName(className, useMap);
    }
  }
  return null;
}

function isThisOrContainer(expr: any): boolean {
  if (expr?.kind === "variable" && expr.name === "this") {
    return true;
  }
  if (expr?.kind === "propertylookup") {
    const prop = expr.offset?.name;
    return prop === "container" || prop === "getContainer";
  }
  return false;
}

function walk(node: any, visitor: (node: any) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        walk(item, visitor);
      }
    } else if (child && typeof child === "object") {
      walk(child, visitor);
    }
  }
}

export function parseSymfonyStrings(
  content: string,
  filePath: string
): SymfonyStringLiteral[] {
  const results: SymfonyStringLiteral[] = [];
  const useMap = extractUseMap(content);

  let ast: any;
  try {
    ast = engine.parseCode(content, filePath);
  } catch {
    return parseSymfonyStringsRegex(content, extractUseMap(content));
  }

  walk(ast, (node) => {
    if (node.kind === "call") {
      const method = getMethodName(node.what);
      if (!method) {
        return;
      }

      const args = node.arguments ?? [];
      const firstArg = args[0];

      if (TWIG_METHODS.has(method) && isThisOrContainer(node.what?.what ?? node.what)) {
        const value = getStringValue(firstArg);
        const range = positionFromNode(firstArg);
        if (value && range && (value.endsWith(".twig") || value.startsWith("@"))) {
          results.push({ kind: "twig_template", value, range });
        }
      }

      if (ROUTE_METHODS.has(method) && isThisOrContainer(node.what?.what ?? node.what)) {
        const value = getStringValue(firstArg);
        const range = positionFromNode(firstArg);
        if (value && range) {
          results.push({ kind: "route_name", value, range });
        }
      }

      if (method === "getRepository") {
        const entityClass = getClassConstEntity(firstArg, useMap);
        const range = positionFromNode(firstArg);
        if (entityClass && range) {
          results.push({
            kind: "entity_class",
            value: entityClass,
            entityClass,
            range,
          });
        }
      }
    }

    if (node.kind === "call" && getMethodName(node.what) === "get") {
      const what = node.what?.what;
      if (
        what?.kind === "propertylookup" &&
        what.offset?.name === "container"
      ) {
        const value = getStringValue(node.arguments?.[0]);
        const range = positionFromNode(node.arguments?.[0]);
        if (value && range) {
          results.push({ kind: "service_id", value, range });
        }
      }
    }

    // #[Template('foo.twig')] or @Template("foo.twig")
    if (node.kind === "attribute" || node.kind === "comment") {
      const text = node.value ?? node.raw ?? "";
      const templateMatch = text.match(/@?Template\s*\(\s*['"]([^'"]+\.twig)['"]\s*\)/);
      if (templateMatch) {
        const range = positionFromNode(node);
        if (range) {
          results.push({
            kind: "twig_template",
            value: templateMatch[1],
            range,
          });
        }
      }
    }
  });

  if (results.length === 0) {
    return parseSymfonyStringsRegex(content, useMap);
  }

  return dedupeResults(results);
}

function parseSymfonyStringsRegex(
  content: string,
  useMap: Map<string, string>
): SymfonyStringLiteral[] {
  const results: SymfonyStringLiteral[] = [];
  const lines = content.split("\n");

  const patterns: {
    regex: RegExp;
    kind: SymfonyStringKind;
    group: number;
    filter?: (value: string) => boolean;
  }[] = [
    {
      regex: /->(?:render|renderView|renderBlock)\(\s*['"]([^'"]+)['"]/g,
      kind: "twig_template",
      group: 1,
      filter: (v: string) => v.endsWith(".twig") || v.startsWith("@"),
    },
    {
      regex: /->(?:generateUrl|redirectToRoute|redirect)\(\s*['"]([^'"]+)['"]/g,
      kind: "route_name",
      group: 1,
    },
    {
      regex: /->container->get\(\s*['"]([^'"]+)['"]/g,
      kind: "service_id",
      group: 1,
    },
    {
      regex: /->getRepository\(\s*([\w\\]+)::class\s*\)/g,
      kind: "entity_class",
      group: 1,
    },
    {
      regex: /@Template\s*\(\s*['"]([^'"]+\.twig)['"]\s*\)/g,
      kind: "twig_template",
      group: 1,
    },
  ];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    for (const { regex, kind, group, filter } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const rawValue = match[group];
        if (filter && !filter(rawValue)) {
          continue;
        }
        const value =
          kind === "entity_class"
            ? resolveClassName(rawValue, useMap)
            : rawValue;
        const start = match.index + match[0].indexOf(rawValue);
        results.push({
          kind,
          value,
          entityClass: kind === "entity_class" ? value : undefined,
          range: {
            startLine: lineNum,
            startCharacter: start,
            endLine: lineNum,
            endCharacter: start + value.length,
          },
        });
      }
    }
  }

  return dedupeResults(results);
}

function dedupeResults(results: SymfonyStringLiteral[]): SymfonyStringLiteral[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.range.startLine}:${r.range.startCharacter}:${r.kind}:${r.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface RepositoryChainContext {
  repositoryClass: string;
  entityClass: string;
  chainStartLine: number;
  chainStartCharacter: number;
  memberPrefix: string;
}

export function findRepositoryChainContext(
  content: string,
  line: number,
  character: number,
  entityToRepository: Map<string, string>
): RepositoryChainContext | null {
  const lines = content.split("\n");
  const useMap = extractUseMap(content);
  const currentLine = lines[line] ?? "";

  const beforeCursor = currentLine.slice(0, character);

  // Match $this->em()->getRepository(Entity::class)->findMethod(...)
  // getRepository may be preceded by em(), getManager(), etc.
  const chainPattern =
    /getRepository\(\s*([\w\\]+)::class\s*\)(?:->[\w$]+)*->([\w]*)$/;

  let chainMatch = beforeCursor.match(chainPattern);

  if (!chainMatch) {
    const context = lines.slice(Math.max(0, line - 5), line + 1).join("\n");
    chainMatch = context.match(chainPattern);
  }

  if (!chainMatch) {
    return null;
  }

  const entityClass = resolveClassName(chainMatch[1], useMap);
  const repositoryClass = entityToRepository.get(entityClass);
  if (!repositoryClass) {
    return null;
  }

  return {
    repositoryClass,
    entityClass,
    chainStartLine: line,
    chainStartCharacter: character,
    memberPrefix: chainMatch[2] ?? "",
  };
}

/** Cursor on a repository method after getRepository(Entity::class)->method */
export function findRepositoryMethodAtPosition(
  content: string,
  line: number,
  character: number,
  entityToRepository: Map<string, string>
): {
  repositoryClass: string;
  entityClass: string;
  methodName: string;
  methodRange: SymfonyStringLiteral["range"];
} | null {
  const chain = findRepositoryChainContext(
    content,
    line,
    character,
    entityToRepository
  );
  if (!chain) {
    return null;
  }

  const currentLine = content.split("\n")[line] ?? "";
  const beforeCursor = currentLine.slice(0, character);
  const methodMatch = beforeCursor.match(/->([\w]+)$/);
  if (!methodMatch) {
    return null;
  }

  const methodName = methodMatch[1];
  const methodStart = beforeCursor.length - methodName.length;

  return {
    repositoryClass: chain.repositoryClass,
    entityClass: chain.entityClass,
    methodName,
    methodRange: {
      startLine: line,
      startCharacter: methodStart,
      endLine: line,
      endCharacter: methodStart + methodName.length,
    },
  };
}

export function getClassMethods(content: string): string[] {
  return [...content.matchAll(/function\s+(\w+)\s*\(/g)]
    .map((m) => m[1])
    .filter((m) => !m.startsWith("__") && m !== "getEntityClass");
}
