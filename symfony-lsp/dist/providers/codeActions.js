"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOVE_CLASS_COMMAND = exports.RENAME_CLASS_COMMAND = void 0;
exports.provideCodeActions = provideCodeActions;
exports.handleExecuteCommand = handleExecuteCommand;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_1 = require("vscode-languageserver/node");
const classAtCursor_js_1 = require("../refactor/classAtCursor.js");
const classRefactor_js_1 = require("../refactor/classRefactor.js");
const composer_js_1 = require("../utils/composer.js");
const paths_js_1 = require("../utils/paths.js");
exports.RENAME_CLASS_COMMAND = "symfony-lsp.renameClass";
exports.MOVE_CLASS_COMMAND = "symfony-lsp.moveClass";
function isBarePhpIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function isQualifiedFqcn(value) {
    const normalized = value.replace(/^\\/, "").trim();
    if (!normalized.includes("\\")) {
        return false;
    }
    const segments = normalized.split("\\");
    return segments.every((segment) => isBarePhpIdentifier(segment));
}
async function promptForInput(connection, prompt, value) {
    try {
        const result = (await connection.sendRequest("window/showInputBox", { prompt, value }));
        const input = result?.value?.trim();
        return input ? input : null;
    }
    catch {
        await connection.window.showErrorMessage("Input prompt is not supported by this editor for Symfony LSP refactor commands.");
        return null;
    }
}
function parseCommandArgs(args) {
    if (args.length < 6) {
        return null;
    }
    const [uri, line, character, fqcn, declPath, projectRoot] = args;
    if (typeof uri !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number" ||
        typeof fqcn !== "string" ||
        typeof declPath !== "string" ||
        typeof projectRoot !== "string") {
        return null;
    }
    return { uri, line, character, fqcn, declPath, projectRoot };
}
function buildCommandArgs(document, position, declaration, projectRoot) {
    return {
        uri: document.uri,
        line: position.line,
        character: position.character,
        fqcn: declaration.fqcn,
        declPath: declaration.declPath,
        projectRoot,
    };
}
function provideCodeActions(document, range, projectRoot) {
    if (!projectRoot) {
        return [];
    }
    const filePath = (0, paths_js_1.fileUriToPath)(document.uri);
    const position = range.start;
    const declaration = (0, classAtCursor_js_1.classAtCursor)(document.getText(), filePath, projectRoot, position.line, position.character);
    if (!declaration) {
        return [];
    }
    const args = buildCommandArgs(document, position, declaration, projectRoot);
    return [
        {
            title: "Rename class...",
            kind: node_1.CodeActionKind.RefactorRewrite,
            command: {
                title: "Rename class",
                command: exports.RENAME_CLASS_COMMAND,
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
            kind: node_1.CodeActionKind.RefactorRewrite,
            command: {
                title: "Move class to namespace",
                command: exports.MOVE_CLASS_COMMAND,
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
async function applyClassRefactor(connection, projectRoot, oldFqcn, oldDeclPath, newFqcn, newDeclPath) {
    const validationError = (0, classRefactor_js_1.validateRenameTarget)(projectRoot, oldFqcn, oldDeclPath, newFqcn, newDeclPath);
    if (validationError) {
        await connection.window.showErrorMessage(validationError);
        return false;
    }
    const edit = (0, classRefactor_js_1.buildClassRefactorWorkspaceEdit)({
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
    await connection.window.showInformationMessage(`Refactored ${oldFqcn} → ${newFqcn}`);
    return true;
}
async function handleRenameClass(connection, args) {
    const currentBasename = (0, composer_js_1.basenameFromFqcn)(args.fqcn);
    const input = await promptForInput(connection, "New class name", currentBasename);
    if (!input) {
        return;
    }
    if (!isBarePhpIdentifier(input)) {
        await connection.window.showErrorMessage("Rename a class to a simple name (e.g. FooService).");
        return;
    }
    if (input === currentBasename) {
        await connection.window.showErrorMessage("New class name is the same as the current one.");
        return;
    }
    const namespace = (0, composer_js_1.namespaceFromFqcn)(args.fqcn);
    if (!namespace) {
        await connection.window.showErrorMessage("Not a namespaced class.");
        return;
    }
    const newFqcn = `${namespace}\\${input}`;
    const newDeclPath = (0, classRefactor_js_1.renamedFilePath)(args.declPath, input);
    await applyClassRefactor(connection, args.projectRoot, args.fqcn, args.declPath, newFqcn, newDeclPath);
}
async function handleMoveClass(connection, args) {
    const input = await promptForInput(connection, "Target FQCN (e.g. App\\Module\\Service\\FooService)", args.fqcn);
    if (!input) {
        return;
    }
    const newFqcn = input.replace(/^\\/, "").trim();
    if (!isQualifiedFqcn(newFqcn)) {
        await connection.window.showErrorMessage("Enter a fully qualified class name (e.g. App\\Module\\Service\\FooService).");
        return;
    }
    if (newFqcn === args.fqcn) {
        await connection.window.showErrorMessage("Target class is the same as the current one.");
        return;
    }
    const newDeclPath = (0, classRefactor_js_1.movedFilePath)(args.projectRoot, newFqcn);
    if (!newDeclPath) {
        await connection.window.showErrorMessage("Target FQCN does not map to a PSR-4 path in composer.json.");
        return;
    }
    if (fs.existsSync(newDeclPath)) {
        await connection.window.showErrorMessage("Target file already exists.");
        return;
    }
    await applyClassRefactor(connection, args.projectRoot, args.fqcn, args.declPath, newFqcn, newDeclPath);
}
async function handleExecuteCommand(connection, params) {
    const parsed = parseCommandArgs(params.arguments ?? []);
    if (!parsed) {
        await connection.window.showErrorMessage("Invalid refactor command arguments.");
        return;
    }
    if (!fs.existsSync(parsed.declPath)) {
        await connection.window.showErrorMessage("Class declaration file not found.");
        return;
    }
    const projectRoot = (0, paths_js_1.findSymfonyProjectRoot)(parsed.declPath);
    if (!projectRoot || projectRoot !== path.resolve(parsed.projectRoot)) {
        await connection.window.showErrorMessage("Symfony project root not found.");
        return;
    }
    const content = fs.readFileSync(parsed.declPath, "utf8");
    const declaration = (0, classAtCursor_js_1.classAtCursor)(content, parsed.declPath, projectRoot, parsed.line, parsed.character);
    if (!declaration || declaration.fqcn !== parsed.fqcn) {
        await connection.window.showErrorMessage("Refactor is only available on PSR-4 namespace class declarations.");
        return;
    }
    if (params.command === exports.RENAME_CLASS_COMMAND) {
        await handleRenameClass(connection, parsed);
        return;
    }
    if (params.command === exports.MOVE_CLASS_COMMAND) {
        await handleMoveClass(connection, parsed);
        return;
    }
    await connection.window.showErrorMessage(`Unknown command: ${params.command}`);
}
//# sourceMappingURL=codeActions.js.map