import * as fs from "fs";
import * as path from "path";
import {
  CodeAction,
  CodeActionKind,
  Connection,
  ExecuteCommandParams,
  Position,
  Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { classAtCursor } from "../refactor/classAtCursor.js";
import {
  buildClassRefactorWorkspaceEdit,
  movedFilePath,
  renamedFilePath,
  validateRenameTarget,
} from "../refactor/classRefactor.js";
import {
  basenameFromFqcn,
  namespaceFromFqcn,
} from "../utils/composer.js";
import { fileUriToPath, findSymfonyProjectRoot } from "../utils/paths.js";

export const RENAME_CLASS_COMMAND = "symfony-lsp.renameClass";
export const MOVE_CLASS_COMMAND = "symfony-lsp.moveClass";

interface ClassRefactorCommandArgs {
  uri: string;
  line: number;
  character: number;
  fqcn: string;
  declPath: string;
  projectRoot: string;
}

interface ShowInputBoxParams {
  prompt?: string;
  value?: string;
}

interface ShowInputBoxResult {
  value?: string;
}

function isBarePhpIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isQualifiedFqcn(value: string): boolean {
  const normalized = value.replace(/^\\/, "").trim();
  if (!normalized.includes("\\")) {
    return false;
  }

  const segments = normalized.split("\\");
  return segments.every((segment) => isBarePhpIdentifier(segment));
}

async function promptForInput(
  connection: Connection,
  prompt: string,
  value?: string
): Promise<string | null> {
  try {
    const result = (await connection.sendRequest(
      "window/showInputBox",
      { prompt, value } satisfies ShowInputBoxParams
    )) as ShowInputBoxResult | null | undefined;

    const input = result?.value?.trim();
    return input ? input : null;
  } catch {
    await connection.window.showErrorMessage(
      "Input prompt is not supported by this editor for Symfony LSP refactor commands."
    );
    return null;
  }
}

function parseCommandArgs(args: unknown[]): ClassRefactorCommandArgs | null {
  if (args.length < 6) {
    return null;
  }

  const [uri, line, character, fqcn, declPath, projectRoot] = args;
  if (
    typeof uri !== "string" ||
    typeof line !== "number" ||
    typeof character !== "number" ||
    typeof fqcn !== "string" ||
    typeof declPath !== "string" ||
    typeof projectRoot !== "string"
  ) {
    return null;
  }

  return { uri, line, character, fqcn, declPath, projectRoot };
}

function buildCommandArgs(
  document: TextDocument,
  position: Position,
  declaration: NonNullable<ReturnType<typeof classAtCursor>>,
  projectRoot: string
): ClassRefactorCommandArgs {
  return {
    uri: document.uri,
    line: position.line,
    character: position.character,
    fqcn: declaration.fqcn,
    declPath: declaration.declPath,
    projectRoot,
  };
}

export function provideCodeActions(
  document: TextDocument,
  range: Range,
  projectRoot: string | null
): CodeAction[] {
  if (!projectRoot) {
    return [];
  }

  const filePath = fileUriToPath(document.uri);
  const position = range.start;
  const declaration = classAtCursor(
    document.getText(),
    filePath,
    projectRoot,
    position.line,
    position.character
  );

  if (!declaration) {
    return [];
  }

  const args = buildCommandArgs(document, position, declaration, projectRoot);

  return [
    {
      title: "Rename class...",
      kind: CodeActionKind.RefactorRewrite,
      command: {
        title: "Rename class",
        command: RENAME_CLASS_COMMAND,
        arguments: [
          args.uri,
          args.line,
          args.character,
          args.fqcn,
          args.declPath,
          args.projectRoot,
        ],
      },
    },
    {
      title: "Move class to namespace...",
      kind: CodeActionKind.RefactorRewrite,
      command: {
        title: "Move class to namespace",
        command: MOVE_CLASS_COMMAND,
        arguments: [
          args.uri,
          args.line,
          args.character,
          args.fqcn,
          args.declPath,
          args.projectRoot,
        ],
      },
    },
  ];
}

async function applyClassRefactor(
  connection: Connection,
  projectRoot: string,
  oldFqcn: string,
  oldDeclPath: string,
  newFqcn: string,
  newDeclPath: string
): Promise<boolean> {
  const validationError = validateRenameTarget(
    projectRoot,
    oldFqcn,
    oldDeclPath,
    newFqcn,
    newDeclPath
  );
  if (validationError) {
    await connection.window.showErrorMessage(validationError);
    return false;
  }

  const edit = buildClassRefactorWorkspaceEdit({
    projectRoot,
    oldFqcn,
    newFqcn,
    oldDeclPath,
    newDeclPath,
  });

  const result = await connection.workspace.applyEdit({ edit });
  if (!result.applied) {
    await connection.window.showErrorMessage("Failed to apply class refactor.");
    return false;
  }

  await connection.window.showInformationMessage(
    `Refactored ${oldFqcn} → ${newFqcn}`
  );
  return true;
}

async function handleRenameClass(
  connection: Connection,
  args: ClassRefactorCommandArgs
): Promise<void> {
  const currentBasename = basenameFromFqcn(args.fqcn);
  const input = await promptForInput(
    connection,
    "New class name",
    currentBasename
  );
  if (!input) {
    return;
  }

  if (!isBarePhpIdentifier(input)) {
    await connection.window.showErrorMessage(
      "Rename a class to a simple name (e.g. FooService)."
    );
    return;
  }

  if (input === currentBasename) {
    await connection.window.showErrorMessage(
      "New class name is the same as the current one."
    );
    return;
  }

  const namespace = namespaceFromFqcn(args.fqcn);
  if (!namespace) {
    await connection.window.showErrorMessage("Not a namespaced class.");
    return;
  }

  const newFqcn = `${namespace}\\${input}`;
  const newDeclPath = renamedFilePath(args.declPath, input);

  await applyClassRefactor(
    connection,
    args.projectRoot,
    args.fqcn,
    args.declPath,
    newFqcn,
    newDeclPath
  );
}

async function handleMoveClass(
  connection: Connection,
  args: ClassRefactorCommandArgs
): Promise<void> {
  const input = await promptForInput(
    connection,
    "Target FQCN (e.g. App\\Module\\Service\\FooService)",
    args.fqcn
  );
  if (!input) {
    return;
  }

  const newFqcn = input.replace(/^\\/, "").trim();
  if (!isQualifiedFqcn(newFqcn)) {
    await connection.window.showErrorMessage(
      "Enter a fully qualified class name (e.g. App\\Module\\Service\\FooService)."
    );
    return;
  }

  if (newFqcn === args.fqcn) {
    await connection.window.showErrorMessage(
      "Target class is the same as the current one."
    );
    return;
  }

  const newDeclPath = movedFilePath(args.projectRoot, newFqcn);
  if (!newDeclPath) {
    await connection.window.showErrorMessage(
      "Target FQCN does not map to a PSR-4 path in composer.json."
    );
    return;
  }

  if (fs.existsSync(newDeclPath)) {
    await connection.window.showErrorMessage("Target file already exists.");
    return;
  }

  await applyClassRefactor(
    connection,
    args.projectRoot,
    args.fqcn,
    args.declPath,
    newFqcn,
    newDeclPath
  );
}

export async function handleExecuteCommand(
  connection: Connection,
  params: ExecuteCommandParams
): Promise<void> {
  const parsed = parseCommandArgs(params.arguments ?? []);
  if (!parsed) {
    await connection.window.showErrorMessage("Invalid refactor command arguments.");
    return;
  }

  if (!fs.existsSync(parsed.declPath)) {
    await connection.window.showErrorMessage("Class declaration file not found.");
    return;
  }

  const projectRoot = findSymfonyProjectRoot(parsed.declPath);
  if (!projectRoot || projectRoot !== path.resolve(parsed.projectRoot)) {
    await connection.window.showErrorMessage("Symfony project root not found.");
    return;
  }

  const content = fs.readFileSync(parsed.declPath, "utf8");
  const declaration = classAtCursor(
    content,
    parsed.declPath,
    projectRoot,
    parsed.line,
    parsed.character
  );
  if (!declaration || declaration.fqcn !== parsed.fqcn) {
    await connection.window.showErrorMessage(
      "Refactor is only available on PSR-4 namespace class declarations."
    );
    return;
  }

  if (params.command === RENAME_CLASS_COMMAND) {
    await handleRenameClass(connection, parsed);
    return;
  }

  if (params.command === MOVE_CLASS_COMMAND) {
    await handleMoveClass(connection, parsed);
    return;
  }

  await connection.window.showErrorMessage(`Unknown command: ${params.command}`);
}
