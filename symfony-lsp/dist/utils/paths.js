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
exports.resolveClassFile = void 0;
exports.fileUriToPath = fileUriToPath;
exports.pathToFileUri = pathToFileUri;
exports.findSymfonyProjectRoot = findSymfonyProjectRoot;
exports.findSymfonyProjectRootsUnder = findSymfonyProjectRootsUnder;
exports.expandSymfonyPath = expandSymfonyPath;
exports.parseTwigTemplateName = parseTwigTemplateName;
exports.isTwigTemplateReference = isTwigTemplateReference;
exports.resolveTwigTemplate = resolveTwigTemplate;
exports.parseControllerReference = parseControllerReference;
exports.findMethodLine = findMethodLine;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function fileUriToPath(uri) {
    return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}
function pathToFileUri(filePath) {
    const normalized = path.resolve(filePath).replace(/\\/g, "/");
    if (process.platform === "win32" && !normalized.startsWith("/")) {
        return `file:///${normalized}`;
    }
    return `file://${normalized}`;
}
function findSymfonyProjectRoot(startPath) {
    let current = path.isAbsolute(startPath)
        ? startPath
        : path.resolve(startPath);
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
        current = path.dirname(current);
    }
    while (true) {
        const composerPath = path.join(current, "composer.json");
        if (fs.existsSync(composerPath)) {
            try {
                const composer = JSON.parse(fs.readFileSync(composerPath, "utf8"));
                const require = {
                    ...composer.require,
                    ...composer["require-dev"],
                };
                const hasSymfony = Object.keys(require ?? {}).some((pkg) => pkg.startsWith("symfony/"));
                if (hasSymfony) {
                    return current;
                }
            }
            catch {
                // ignore invalid composer.json
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
function isSymfonyProjectRoot(dir) {
    const resolved = path.resolve(dir);
    return findSymfonyProjectRoot(resolved) === resolved;
}
/** Discover Symfony project roots under a workspace folder (skips vendor/node_modules). */
function findSymfonyProjectRootsUnder(startDir, maxDepth = 4) {
    const roots = new Set();
    const resolvedStart = path.resolve(startDir);
    if (isSymfonyProjectRoot(resolvedStart)) {
        roots.add(resolvedStart);
        return [...roots];
    }
    function walk(dir, depth) {
        if (depth > maxDepth) {
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (entry.name === "vendor" ||
                entry.name === "node_modules" ||
                entry.name.startsWith(".")) {
                continue;
            }
            const subDir = path.join(dir, entry.name);
            if (isSymfonyProjectRoot(subDir)) {
                roots.add(path.resolve(subDir));
                continue;
            }
            walk(subDir, depth + 1);
        }
    }
    walk(resolvedStart, 1);
    return [...roots];
}
var composer_js_1 = require("./composer.js");
Object.defineProperty(exports, "resolveClassFile", { enumerable: true, get: function () { return composer_js_1.resolveClassFile; } });
function expandSymfonyPath(value, projectRoot) {
    const expanded = value
        .replace(/%kernel\.project_dir%/g, projectRoot)
        .replace(/%kernel\.root_dir%/g, path.join(projectRoot, "src"))
        .trim();
    if (path.isAbsolute(expanded)) {
        return expanded;
    }
    return path.join(projectRoot, expanded);
}
/** Parse `@Statistics/personal/user.twig` into namespace + relative path. */
function parseTwigTemplateName(templateName) {
    const normalized = templateName.replace(/\\/g, "/").trim();
    if (normalized.startsWith("@")) {
        const slash = normalized.indexOf("/");
        if (slash > 1) {
            return {
                namespace: normalized.slice(1, slash),
                relativePath: normalized.slice(slash + 1),
            };
        }
        return { namespace: normalized.slice(1), relativePath: "" };
    }
    return { namespace: null, relativePath: normalized };
}
function isTwigTemplateReference(value) {
    return value.endsWith(".twig") || value.startsWith("@");
}
function tryFileCandidates(candidates) {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
function resolveTwigTemplate(projectRoot, templateName, twig) {
    const { namespace, relativePath } = parseTwigTemplateName(templateName);
    // @Statistics/personal/user.twig → namespace "Statistics"
    if (namespace) {
        const viewRoots = twig.namespaces.get(namespace) ?? [];
        for (const viewsRoot of viewRoots) {
            const resolved = tryFileCandidates([
                path.join(viewsRoot, relativePath),
                path.join(viewsRoot, "templates", relativePath),
            ]);
            if (resolved) {
                return resolved;
            }
        }
        // Domain bundle convention: src/Statistics/Resources/views/
        const bundleViews = path.join(projectRoot, "src", namespace, "Resources", "views", relativePath);
        if (fs.existsSync(bundleViews)) {
            return bundleViews;
        }
        // Vendor bundle: src/StatisticsBundle/Resources/views/ (strip Bundle suffix try)
        if (!namespace.endsWith("Bundle")) {
            const bundleAlt = path.join(projectRoot, "src", `${namespace}Bundle`, "Resources", "views", relativePath);
            if (fs.existsSync(bundleAlt)) {
                return bundleAlt;
            }
        }
    }
    // Main namespace (no @ prefix)
    for (const loaderPath of twig.loaderPaths) {
        const absLoader = path.isAbsolute(loaderPath)
            ? loaderPath
            : path.join(projectRoot, loaderPath);
        const resolved = tryFileCandidates([
            path.join(absLoader, relativePath),
            path.join(absLoader, "templates", relativePath),
        ]);
        if (resolved) {
            return resolved;
        }
    }
    const fallbacks = [
        path.join(projectRoot, "templates", relativePath),
        path.join(projectRoot, relativePath),
    ];
    return tryFileCandidates(fallbacks);
}
function parseControllerReference(controller) {
    const match = controller.match(/^(.+?)::(\w+)$/);
    if (!match) {
        return null;
    }
    return { className: match[1], method: match[2] };
}
function findMethodLine(filePath, methodName) {
    if (!fs.existsSync(filePath)) {
        return 0;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const patterns = [
        new RegExp(`function\\s+${methodName}\\s*\\(`),
        new RegExp(`function\\s+${methodName.replace(/Action$/, "")}\\s*\\(`),
    ];
    for (let i = 0; i < lines.length; i++) {
        if (patterns.some((p) => p.test(lines[i]))) {
            return i;
        }
    }
    return 0;
}
//# sourceMappingURL=paths.js.map