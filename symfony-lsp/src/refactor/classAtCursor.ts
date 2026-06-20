import { Engine } from "php-parser";
import {
  filePathFromFqcn,
  fqcnFromFilePath,
  isDependencyPath,
} from "../utils/composer.js";

export interface ClassDeclarationAtCursor {
  fqcn: string;
  basename: string;
  declPath: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
}

const engine = new Engine({
  parser: {
    extractDoc: true,
    suppressErrors: true,
  },
  ast: {
    withPositions: true,
  },
});

export function offsetAtLine(
  content: string,
  line: number,
  character: number
): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset + character;
}

function locToRange(loc: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): ClassDeclarationAtCursor["range"] {
  return {
    startLine: loc.start.line - 1,
    startCharacter: loc.start.column,
    endLine: loc.end.line - 1,
    endCharacter: loc.end.column,
  };
}

function offsetInLoc(
  content: string,
  loc: { start: { line: number; column: number }; end: { line: number; column: number } },
  offset: number
): boolean {
  const start = offsetAtLine(content, loc.start.line - 1, loc.start.column);
  const end = offsetAtLine(content, loc.end.line - 1, loc.end.column);
  return offset >= start && offset <= end;
}

function getNamespace(ast: any): string | null {
  for (const child of ast?.children ?? []) {
    if (child?.kind !== "namespace") {
      continue;
    }

    const nameNode = child.name;
    if (nameNode?.kind === "identifier") {
      return nameNode.name;
    }
    if (typeof nameNode === "string") {
      return nameNode;
    }
  }

  return null;
}

function findDeclarationAtOffset(
  node: any,
  content: string,
  offset: number
): { name: string; range: ClassDeclarationAtCursor["range"] } | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (
    node.kind === "class" ||
    node.kind === "interface" ||
    node.kind === "trait"
  ) {
    const nameNode = node.id ?? node.name;
    const name = nameNode?.name;
    if (name && nameNode?.loc && offsetInLoc(content, nameNode.loc, offset)) {
      return { name, range: locToRange(nameNode.loc) };
    }
  }

  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findDeclarationAtOffset(item, content, offset);
        if (found) {
          return found;
        }
      }
    } else if (child && typeof child === "object") {
      const found = findDeclarationAtOffset(child, content, offset);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function isEligibleDeclaration(
  fqcn: string,
  filePath: string,
  projectRoot: string
): boolean {
  const mappedFqcn = fqcnFromFilePath(filePath, projectRoot);
  const resolvedPath = filePathFromFqcn(fqcn, projectRoot);
  return Boolean(resolvedPath && mappedFqcn === fqcn);
}

export function classAtCursor(
  content: string,
  filePath: string,
  projectRoot: string,
  line: number,
  character: number
): ClassDeclarationAtCursor | null {
  if (isDependencyPath(filePath, projectRoot)) {
    return null;
  }

  const byteOffset = offsetAtLine(content, line, character);

  let ast: any;
  try {
    ast = engine.parseCode(content, filePath);
  } catch {
    return classAtCursorRegex(content, filePath, projectRoot, line, character);
  }

  const namespace = getNamespace(ast);
  if (!namespace) {
    return null;
  }

  const declaration = findDeclarationAtOffset(ast, content, byteOffset);
  if (!declaration) {
    return classAtCursorRegex(content, filePath, projectRoot, line, character);
  }

  const fqcn = `${namespace}\\${declaration.name}`;
  if (!isEligibleDeclaration(fqcn, filePath, projectRoot)) {
    return null;
  }

  return {
    fqcn,
    basename: declaration.name,
    declPath: filePath,
    range: declaration.range,
  };
}

function classAtCursorRegex(
  content: string,
  filePath: string,
  projectRoot: string,
  line: number,
  character: number
): ClassDeclarationAtCursor | null {
  const namespaceMatch = content.match(/^namespace\s+([\w\\]+)\s*;/m);
  if (!namespaceMatch) {
    return null;
  }

  const namespace = namespaceMatch[1];
  const currentLine = content.split("\n")[line] ?? "";
  const pattern = /\b(class|interface|trait)\s+(\w+)/g;

  let match;
  while ((match = pattern.exec(currentLine)) !== null) {
    const name = match[2];
    const nameStart = match.index + match[0].indexOf(name);
    const nameEnd = nameStart + name.length;
    if (character >= nameStart && character <= nameEnd) {
      const fqcn = `${namespace}\\${name}`;
      if (!isEligibleDeclaration(fqcn, filePath, projectRoot)) {
        return null;
      }

      return {
        fqcn,
        basename: name,
        declPath: filePath,
        range: {
          startLine: line,
          startCharacter: nameStart,
          endLine: line,
          endCharacter: nameEnd,
        },
      };
    }
  }

  return null;
}
