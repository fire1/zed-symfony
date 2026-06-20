import * as fs from "fs";
import * as path from "path";
import {
  RenameFile,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import {
  basenameFromFqcn,
  filePathFromFqcn,
  fqcnFromFilePath,
  isDependencyPath,
  namespaceFromFqcn,
} from "../utils/composer.js";
import { pathToFileUri } from "../utils/paths.js";

const SEARCH_DIRS = ["src", "lib", "tests", "config", "templates", "public", "bin"];
const SCAN_EXTENSIONS = new Set([
  "php",
  "yaml",
  "yml",
  "twig",
  "json",
  "js",
  "md",
  "sh",
]);

export interface ClassRefactorRequest {
  projectRoot: string;
  oldFqcn: string;
  newFqcn: string;
  oldDeclPath: string;
  newDeclPath: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function replaceFqcn(content: string, oldFqcn: string, newFqcn: string): string {
  let result = content.split(oldFqcn).join(newFqcn);
  const oldEscaped = oldFqcn.replace(/\\/g, "\\\\");
  const newEscaped = newFqcn.replace(/\\/g, "\\\\");
  result = result.split(oldEscaped).join(newEscaped);
  return result;
}

function rewriteDeclarationKind(
  content: string,
  oldBasename: string,
  newBasename: string
): string {
  const kinds = ["class", "interface", "trait"] as const;
  let result = content;
  for (const kind of kinds) {
    const pattern = new RegExp(`\\b${escapeRegex(kind)}\\s+${escapeRegex(oldBasename)}\\b`);
    result = result.replace(pattern, `${kind} ${newBasename}`);
  }
  return result;
}

function rewriteNamespaceDeclaration(
  content: string,
  oldNamespace: string | null,
  newNamespace: string | null
): string {
  if (!oldNamespace || !newNamespace || oldNamespace === newNamespace) {
    return content;
  }

  return content.replace(
    new RegExp(`^namespace\\s+${escapeRegex(oldNamespace)}\\s*;`, "m"),
    `namespace ${newNamespace};`
  );
}

function rewritePhpShortReferences(
  content: string,
  oldBasename: string,
  newBasename: string,
  oldFqcn: string
): string {
  const useMap = extractUseMap(content);
  const aliasesForOld = [...useMap.entries()]
    .filter(([, fqcn]) => fqcn === oldFqcn)
    .map(([alias]) => alias);

  const tokens = new Set([oldBasename, ...aliasesForOld]);
  let result = content;

  for (const token of tokens) {
    const tokenPattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "g");
    result = result.replace(tokenPattern, (match, offset) => {
      const before = result.slice(Math.max(0, offset - 12), offset);
      if (/function\s$/.test(before)) {
        return match;
      }
      return newBasename;
    });
  }

  return result;
}

function rewriteFileContent(
  filePath: string,
  request: ClassRefactorRequest,
  content: string
): string | null {
  const oldBasename = basenameFromFqcn(request.oldFqcn);
  const newBasename = basenameFromFqcn(request.newFqcn);
  const ext = path.extname(filePath).slice(1).toLowerCase();

  let updated = replaceFqcn(content, request.oldFqcn, request.newFqcn);

  if (ext === "php") {
    if (path.resolve(filePath) === path.resolve(request.oldDeclPath)) {
      updated = rewriteDeclarationKind(updated, oldBasename, newBasename);
      updated = rewriteNamespaceDeclaration(
        updated,
        namespaceFromFqcn(request.oldFqcn),
        namespaceFromFqcn(request.newFqcn)
      );
    } else {
      updated = rewritePhpShortReferences(
        updated,
        oldBasename,
        newBasename,
        request.oldFqcn
      );
    }
  }

  return updated === content ? null : updated;
}

function collectProjectFiles(projectRoot: string): string[] {
  const files: string[] = [];

  for (const dirName of SEARCH_DIRS) {
    const fullDir = path.join(projectRoot, dirName);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
      continue;
    }

    walkDirectory(fullDir, projectRoot, files);
  }

  return files;
}

function walkDirectory(
  dir: string,
  projectRoot: string,
  files: string[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isDependencyPath(fullPath, projectRoot)) {
        continue;
      }
      walkDirectory(fullPath, projectRoot, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).slice(1).toLowerCase();
    if (!SCAN_EXTENSIONS.has(ext)) {
      continue;
    }

    if (isDependencyPath(fullPath, projectRoot)) {
      continue;
    }

    files.push(fullPath);
  }
}

export function buildClassRefactorWorkspaceEdit(
  request: ClassRefactorRequest
): WorkspaceEdit {
  const documentChanges: (TextDocumentEdit | RenameFile)[] = [];
  const oldBasename = basenameFromFqcn(request.oldFqcn);

  for (const filePath of collectProjectFiles(request.projectRoot)) {
    const original = fs.readFileSync(filePath, "utf8");
    if (
      !original.includes(oldBasename) &&
      !original.includes(request.oldFqcn)
    ) {
      continue;
    }

    const updated = rewriteFileContent(filePath, request, original);
    if (!updated) {
      continue;
    }

    documentChanges.push({
      textDocument: {
        uri: pathToFileUri(filePath),
        version: null,
      },
      edits: [TextEdit.replace({ start: { line: 0, character: 0 }, end: { line: Number.MAX_SAFE_INTEGER, character: 0 } }, updated)],
    });
  }

  if (path.resolve(request.oldDeclPath) !== path.resolve(request.newDeclPath)) {
    documentChanges.push({
      kind: "rename",
      oldUri: pathToFileUri(request.oldDeclPath),
      newUri: pathToFileUri(request.newDeclPath),
    });
  }

  return { documentChanges };
}

export function validateRenameTarget(
  projectRoot: string,
  oldFqcn: string,
  oldDeclPath: string,
  newFqcn: string,
  newDeclPath: string
): string | null {
  const resolvedOld = fqcnFromFilePath(oldDeclPath, projectRoot);
  if (!resolvedOld || resolvedOld !== oldFqcn) {
    return "Not a PSR-4 namespace class declaration.";
  }

  if (isDependencyPath(oldDeclPath, projectRoot)) {
    return "Cannot refactor classes in vendor or dependencies.";
  }

  if (path.resolve(oldDeclPath) !== path.resolve(newDeclPath)) {
    if (fs.existsSync(newDeclPath)) {
      return "Target file already exists.";
    }
  }

  const newResolved = fqcnFromFilePath(newDeclPath, projectRoot);
  if (newResolved && newResolved !== oldFqcn && fs.existsSync(newDeclPath)) {
    return "Target file already exists.";
  }

  if (!newFqcn.includes("\\")) {
    return "Target must be a namespaced class.";
  }

  return null;
}

export function renamedFilePath(
  declPath: string,
  newBasename: string
): string {
  return path.join(path.dirname(declPath), `${newBasename}.php`);
}

export function movedFilePath(
  projectRoot: string,
  newFqcn: string
): string | null {
  return filePathFromFqcn(newFqcn, projectRoot);
}
