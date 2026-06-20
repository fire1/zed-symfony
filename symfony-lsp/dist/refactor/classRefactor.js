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
exports.buildClassRefactorWorkspaceEdit = buildClassRefactorWorkspaceEdit;
exports.validateRenameTarget = validateRenameTarget;
exports.renamedFilePath = renamedFilePath;
exports.movedFilePath = movedFilePath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_1 = require("vscode-languageserver/node");
const composer_js_1 = require("../utils/composer.js");
const paths_js_1 = require("../utils/paths.js");
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
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractUseMap(content) {
    const uses = new Map();
    for (const match of content.matchAll(/^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
        const fqcn = match[1];
        const alias = match[2] ?? fqcn.split("\\").pop();
        uses.set(alias, fqcn);
    }
    return uses;
}
function replaceFqcn(content, oldFqcn, newFqcn) {
    let result = content.split(oldFqcn).join(newFqcn);
    const oldEscaped = oldFqcn.replace(/\\/g, "\\\\");
    const newEscaped = newFqcn.replace(/\\/g, "\\\\");
    result = result.split(oldEscaped).join(newEscaped);
    return result;
}
function rewriteDeclarationKind(content, oldBasename, newBasename) {
    const kinds = ["class", "interface", "trait"];
    let result = content;
    for (const kind of kinds) {
        const pattern = new RegExp(`\\b${escapeRegex(kind)}\\s+${escapeRegex(oldBasename)}\\b`);
        result = result.replace(pattern, `${kind} ${newBasename}`);
    }
    return result;
}
function rewriteNamespaceDeclaration(content, oldNamespace, newNamespace) {
    if (!oldNamespace || !newNamespace || oldNamespace === newNamespace) {
        return content;
    }
    return content.replace(new RegExp(`^namespace\\s+${escapeRegex(oldNamespace)}\\s*;`, "m"), `namespace ${newNamespace};`);
}
function rewritePhpShortReferences(content, oldBasename, newBasename, oldFqcn) {
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
function rewriteFileContent(filePath, request, content) {
    const oldBasename = (0, composer_js_1.basenameFromFqcn)(request.oldFqcn);
    const newBasename = (0, composer_js_1.basenameFromFqcn)(request.newFqcn);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    let updated = replaceFqcn(content, request.oldFqcn, request.newFqcn);
    if (ext === "php") {
        if (path.resolve(filePath) === path.resolve(request.oldDeclPath)) {
            updated = rewriteDeclarationKind(updated, oldBasename, newBasename);
            updated = rewriteNamespaceDeclaration(updated, (0, composer_js_1.namespaceFromFqcn)(request.oldFqcn), (0, composer_js_1.namespaceFromFqcn)(request.newFqcn));
        }
        else {
            updated = rewritePhpShortReferences(updated, oldBasename, newBasename, request.oldFqcn);
        }
    }
    return updated === content ? null : updated;
}
function collectProjectFiles(projectRoot) {
    const files = [];
    for (const dirName of SEARCH_DIRS) {
        const fullDir = path.join(projectRoot, dirName);
        if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
            continue;
        }
        walkDirectory(fullDir, projectRoot, files);
    }
    return files;
}
function walkDirectory(dir, projectRoot, files) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if ((0, composer_js_1.isDependencyPath)(fullPath, projectRoot)) {
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
        if ((0, composer_js_1.isDependencyPath)(fullPath, projectRoot)) {
            continue;
        }
        files.push(fullPath);
    }
}
function buildClassRefactorWorkspaceEdit(request) {
    const documentChanges = [];
    const oldBasename = (0, composer_js_1.basenameFromFqcn)(request.oldFqcn);
    for (const filePath of collectProjectFiles(request.projectRoot)) {
        const original = fs.readFileSync(filePath, "utf8");
        if (!original.includes(oldBasename) &&
            !original.includes(request.oldFqcn)) {
            continue;
        }
        const updated = rewriteFileContent(filePath, request, original);
        if (!updated) {
            continue;
        }
        documentChanges.push({
            textDocument: {
                uri: (0, paths_js_1.pathToFileUri)(filePath),
                version: null,
            },
            edits: [node_1.TextEdit.replace({ start: { line: 0, character: 0 }, end: { line: Number.MAX_SAFE_INTEGER, character: 0 } }, updated)],
        });
    }
    if (path.resolve(request.oldDeclPath) !== path.resolve(request.newDeclPath)) {
        documentChanges.push({
            kind: "rename",
            oldUri: (0, paths_js_1.pathToFileUri)(request.oldDeclPath),
            newUri: (0, paths_js_1.pathToFileUri)(request.newDeclPath),
        });
    }
    return { documentChanges };
}
function validateRenameTarget(projectRoot, oldFqcn, oldDeclPath, newFqcn, newDeclPath) {
    const resolvedOld = (0, composer_js_1.fqcnFromFilePath)(oldDeclPath, projectRoot);
    if (!resolvedOld || resolvedOld !== oldFqcn) {
        return "Not a PSR-4 namespace class declaration.";
    }
    if ((0, composer_js_1.isDependencyPath)(oldDeclPath, projectRoot)) {
        return "Cannot refactor classes in vendor or dependencies.";
    }
    if (path.resolve(oldDeclPath) !== path.resolve(newDeclPath)) {
        if (fs.existsSync(newDeclPath)) {
            return "Target file already exists.";
        }
    }
    const newResolved = (0, composer_js_1.fqcnFromFilePath)(newDeclPath, projectRoot);
    if (newResolved && newResolved !== oldFqcn && fs.existsSync(newDeclPath)) {
        return "Target file already exists.";
    }
    if (!newFqcn.includes("\\")) {
        return "Target must be a namespaced class.";
    }
    return null;
}
function renamedFilePath(declPath, newBasename) {
    return path.join(path.dirname(declPath), `${newBasename}.php`);
}
function movedFilePath(projectRoot, newFqcn) {
    return (0, composer_js_1.filePathFromFqcn)(newFqcn, projectRoot);
}
//# sourceMappingURL=classRefactor.js.map