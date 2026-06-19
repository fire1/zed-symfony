#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const projectIndex_js_1 = require("./index/projectIndex.js");
const documentLinks_js_1 = require("./providers/documentLinks.js");
const completion_js_1 = require("./providers/completion.js");
const hover_js_1 = require("./providers/hover.js");
const definition_js_1 = require("./providers/definition.js");
const paths_js_1 = require("./utils/paths.js");
const phpactorConfig_js_1 = require("./utils/phpactorConfig.js");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceFolders = [];
(0, phpactorConfig_js_1.setPhpactorConfigChangeHandler)((result) => {
    const action = result.created ? "created" : "updated";
    connection.window.showInformationMessage(`Symfony LSP ${action} .phpactor.json (Phpactor Symfony integration). Restart the PHP language server to apply.`);
});
function ensurePhpactorForWorkspaceRoots() {
    for (const folder of workspaceFolders) {
        const workspaceRoot = (0, paths_js_1.fileUriToPath)(folder.uri);
        const symfonyRoots = (0, paths_js_1.findSymfonyProjectRootsUnder)(workspaceRoot);
        for (const projectRoot of symfonyRoots) {
            const result = (0, phpactorConfig_js_1.ensurePhpactorConfig)(projectRoot);
            const configPath = `${projectRoot}/.phpactor.json`;
            if (result?.created) {
                connection.console.log(`Phpactor config created at ${result.path}`);
            }
            else if (result?.updated) {
                connection.console.log(`Phpactor config updated at ${result.path}`);
            }
            else {
                connection.console.log(`Phpactor config already complete at ${configPath}`);
            }
        }
        if (symfonyRoots.length === 0) {
            connection.console.log(`No Symfony project found under workspace: ${workspaceRoot}`);
        }
    }
}
connection.onInitialize((params) => {
    workspaceFolders = params.workspaceFolders ?? [];
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            documentLinkProvider: {
                resolveProvider: false,
            },
            completionProvider: {
                triggerCharacters: ["'", '"', ":", "\\"],
            },
            hoverProvider: true,
            definitionProvider: true,
        },
    };
});
connection.onInitialized(() => {
    ensurePhpactorForWorkspaceRoots();
});
async function getIndexForDocument(document) {
    const filePath = (0, paths_js_1.fileUriToPath)(document.uri);
    const projectRoot = (0, paths_js_1.findSymfonyProjectRoot)(filePath);
    if (!projectRoot) {
        return null;
    }
    return projectIndex_js_1.projectIndex.get(projectRoot);
}
connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
        const filePath = (0, paths_js_1.fileUriToPath)(change.uri);
        const projectRoot = (0, paths_js_1.findSymfonyProjectRoot)(filePath);
        if (projectRoot) {
            projectIndex_js_1.projectIndex.invalidate(projectRoot);
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
    return (0, documentLinks_js_1.provideDocumentLinks)(document, index);
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
    return (0, completion_js_1.provideCompletions)(document, index, params.position.line, params.position.character);
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
    return (0, hover_js_1.provideHover)(document, index, params.position.line, params.position.character);
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
    return (0, definition_js_1.provideDefinition)(document, index, params.position.line, params.position.character);
});
documents.listen(connection);
connection.listen();
connection.console.log("Symfony LSP started");
//# sourceMappingURL=server.js.map