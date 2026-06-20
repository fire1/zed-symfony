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
exports.loadPsr4Mappings = loadPsr4Mappings;
exports.isDependencyPath = isDependencyPath;
exports.fqcnFromFilePath = fqcnFromFilePath;
exports.filePathFromFqcn = filePathFromFqcn;
exports.resolveClassFile = resolveClassFile;
exports.namespaceFromFqcn = namespaceFromFqcn;
exports.basenameFromFqcn = basenameFromFqcn;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEPENDENCY_SEGMENTS = new Set(["vendor", "node_modules", ".git"]);
function loadPsr4Mappings(projectRoot) {
    const composerPath = path.join(projectRoot, "composer.json");
    if (!fs.existsSync(composerPath)) {
        return [];
    }
    try {
        const composer = JSON.parse(fs.readFileSync(composerPath, "utf8"));
        const psr4 = composer.autoload?.["psr-4"] ?? {};
        const psr4Dev = composer["autoload-dev"]?.["psr-4"] ?? {};
        const merged = { ...psr4, ...psr4Dev };
        return Object.entries(merged).map(([namespace, dir]) => ({
            namespace: namespace.replace(/\\$/, ""),
            directory: path.join(projectRoot, String(dir).replace(/\\/g, "/")),
        }));
    }
    catch {
        return [];
    }
}
function isDependencyPath(filePath, projectRoot) {
    const rel = path
        .relative(path.resolve(projectRoot), path.resolve(filePath))
        .replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) {
        return false;
    }
    const firstSegment = rel.split("/")[0];
    return DEPENDENCY_SEGMENTS.has(firstSegment);
}
function fqcnFromFilePath(absPath, projectRoot) {
    const resolvedPath = path.resolve(absPath);
    const resolvedRoot = path.resolve(projectRoot);
    const relPath = path
        .relative(resolvedRoot, resolvedPath)
        .replace(/\\/g, "/");
    if (relPath.startsWith("..") || !relPath.endsWith(".php")) {
        return null;
    }
    for (const mapping of loadPsr4Mappings(resolvedRoot)) {
        const dirRel = path
            .relative(resolvedRoot, mapping.directory)
            .replace(/\\/g, "/");
        const prefix = dirRel === "" ? "" : `${dirRel}/`;
        if (relPath === dirRel || relPath.startsWith(prefix)) {
            const subPath = prefix ? relPath.slice(prefix.length) : relPath;
            const classPath = subPath.replace(/\.php$/, "").replace(/\//g, "\\");
            return classPath
                ? `${mapping.namespace}\\${classPath}`
                : mapping.namespace;
        }
    }
    return null;
}
function filePathFromFqcn(fqcn, projectRoot) {
    const normalized = fqcn.replace(/^\\/, "");
    const mappings = loadPsr4Mappings(projectRoot);
    for (const mapping of mappings) {
        const prefix = mapping.namespace;
        if (normalized === prefix) {
            return null;
        }
        if (!normalized.startsWith(`${prefix}\\`)) {
            continue;
        }
        const suffix = normalized.slice(prefix.length + 1).replace(/\\/g, "/");
        const filePath = path.join(mapping.directory, `${suffix}.php`);
        return filePath;
    }
    return null;
}
function resolveClassFile(projectRoot, className) {
    const fromPsr4 = filePathFromFqcn(className, projectRoot);
    if (fromPsr4 && fs.existsSync(fromPsr4)) {
        return fromPsr4;
    }
    return null;
}
function namespaceFromFqcn(fqcn) {
    const normalized = fqcn.replace(/^\\/, "");
    const lastSep = normalized.lastIndexOf("\\");
    if (lastSep <= 0) {
        return null;
    }
    return normalized.slice(0, lastSep);
}
function basenameFromFqcn(fqcn) {
    const normalized = fqcn.replace(/^\\/, "");
    const lastSep = normalized.lastIndexOf("\\");
    return lastSep >= 0 ? normalized.slice(lastSep + 1) : normalized;
}
//# sourceMappingURL=composer.js.map