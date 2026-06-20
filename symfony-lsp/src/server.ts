#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { projectIndex } from "./index/projectIndex.js";
import { provideDocumentLinks } from "./providers/documentLinks.js";
import { provideCompletions } from "./providers/completion.js";
import { provideHover } from "./providers/hover.js";
import { provideDefinition } from "./providers/definition.js";
import {
  handleExecuteCommand,
  MOVE_CLASS_COMMAND,
  provideCodeActions,
  RENAME_CLASS_COMMAND,
} from "./providers/codeActions.js";
import { fileUriToPath, findSymfonyProjectRoot, findSymfonyProjectRootsUnder } from "./utils/paths.js";
import {
  ensurePhpactorConfig,
  setPhpactorConfigChangeHandler,
} from "./utils/phpactorConfig.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceFolders: NonNullable<InitializeParams["workspaceFolders"]> = [];

setPhpactorConfigChangeHandler((result) => {
  const action = result.created ? "created" : "updated";
  connection.window.showInformationMessage(
    `Symfony LSP ${action} .phpactor.json (Phpactor Symfony integration). Restart the PHP language server to apply.`
  );
});

function ensurePhpactorForWorkspaceRoots(): void {
  for (const folder of workspaceFolders) {
    const workspaceRoot = fileUriToPath(folder.uri);
    const symfonyRoots = findSymfonyProjectRootsUnder(workspaceRoot);

    for (const projectRoot of symfonyRoots) {
      const result = ensurePhpactorConfig(projectRoot);
      const configPath = `${projectRoot}/.phpactor.json`;
      if (result?.created) {
        connection.console.log(`Phpactor config created at ${result.path}`);
      } else if (result?.updated) {
        connection.console.log(`Phpactor config updated at ${result.path}`);
      } else {
        connection.console.log(
          `Phpactor config already complete at ${configPath}`
        );
      }
    }

    if (symfonyRoots.length === 0) {
      connection.console.log(
        `No Symfony project found under workspace: ${workspaceRoot}`
      );
    }
  }
}

connection.onInitialize((params: InitializeParams) => {
  workspaceFolders = params.workspaceFolders ?? [];
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentLinkProvider: {
        resolveProvider: false,
      },
      completionProvider: {
        triggerCharacters: ["'", '"', ":", "\\"],
      },
      hoverProvider: true,
      definitionProvider: true,
      codeActionProvider: {
        resolveProvider: false,
      },
      executeCommandProvider: {
        commands: [RENAME_CLASS_COMMAND, MOVE_CLASS_COMMAND],
      },
    },
  };
});

connection.onInitialized(() => {
  ensurePhpactorForWorkspaceRoots();
});

async function getIndexForDocument(
  document: TextDocument
): Promise<ReturnType<typeof projectIndex.get> | null> {
  const filePath = fileUriToPath(document.uri);
  const projectRoot = findSymfonyProjectRoot(filePath);
  if (!projectRoot) {
    return null;
  }
  return projectIndex.get(projectRoot);
}

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const filePath = fileUriToPath(change.uri);
    const projectRoot = findSymfonyProjectRoot(filePath);
    if (projectRoot) {
      projectIndex.invalidate(projectRoot);
    }
  }
});

connection.onDocumentLinks(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const index = await getIndexForDocument(document);
  if (!index) {
    return [];
  }

  return provideDocumentLinks(document, index);
});

connection.onCompletion(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const index = await getIndexForDocument(document);
  if (!index) {
    return [];
  }

  return provideCompletions(
    document,
    index,
    params.position.line,
    params.position.character
  );
});

connection.onHover(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const index = await getIndexForDocument(document);
  if (!index) {
    return null;
  }

  return provideHover(
    document,
    index,
    params.position.line,
    params.position.character
  );
});

connection.onDefinition(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const index = await getIndexForDocument(document);
  if (!index) {
    return null;
  }

  return provideDefinition(
    document,
    index,
    params.position.line,
    params.position.character
  );
});

connection.onCodeAction(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const filePath = fileUriToPath(document.uri);
  const projectRoot = findSymfonyProjectRoot(filePath);
  return provideCodeActions(document, params.range, projectRoot);
});

connection.onExecuteCommand(async (params) => {
  await handleExecuteCommand(connection, params);
});

documents.listen(connection);
connection.listen();

connection.console.log("Symfony LSP started");
