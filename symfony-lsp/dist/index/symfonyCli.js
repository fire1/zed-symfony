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
exports.runSymfonyCommand = runSymfonyCommand;
exports.findContainerXml = findContainerXml;
exports.getCacheMtime = getCacheMtime;
exports.getConfigMtime = getConfigMtime;
exports.resolveTwigViaSymfonyCli = resolveTwigViaSymfonyCli;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function runSymfonyCommand(projectRoot, args, timeoutMs = 30_000) {
    const consolePath = path.join(projectRoot, "bin", "console");
    if (!fs.existsSync(consolePath)) {
        return null;
    }
    const php = process.env.PHP_PATH ?? "php";
    try {
        const { stdout, stderr } = await execFileAsync(php, [consolePath, ...args], {
            cwd: projectRoot,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            env: {
                ...process.env,
                APP_ENV: process.env.APP_ENV ?? "dev",
                APP_DEBUG: process.env.APP_DEBUG ?? "1",
            },
        });
        return { stdout: stdout.trim(), stderr: stderr.trim() };
    }
    catch {
        return null;
    }
}
function findContainerXml(projectRoot) {
    const cacheDir = path.join(projectRoot, "var", "cache", "dev");
    if (!fs.existsSync(cacheDir)) {
        return null;
    }
    const entries = fs.readdirSync(cacheDir);
    const containerFile = entries.find((name) => name.endsWith("Container.xml") || name.endsWith("DebugContainer.xml"));
    if (!containerFile) {
        return null;
    }
    return path.join(cacheDir, containerFile);
}
function getCacheMtime(projectRoot) {
    const cacheDir = path.join(projectRoot, "var", "cache", "dev");
    if (!fs.existsSync(cacheDir)) {
        return 0;
    }
    let latest = 0;
    const stack = [cacheDir];
    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            }
            else {
                try {
                    const mtime = fs.statSync(full).mtimeMs;
                    if (mtime > latest) {
                        latest = mtime;
                    }
                }
                catch {
                    // ignore
                }
            }
        }
    }
    return latest;
}
function getConfigMtime(projectRoot) {
    const dirs = [
        path.join(projectRoot, "config"),
        path.join(projectRoot, "src", "Entity"),
        path.join(projectRoot, "templates"),
    ];
    let latest = 0;
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            continue;
        }
        const stack = [dir];
        while (stack.length > 0) {
            const current = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(full);
                }
                else {
                    try {
                        const mtime = fs.statSync(full).mtimeMs;
                        if (mtime > latest) {
                            latest = mtime;
                        }
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
    }
    return latest;
}
/** Resolve a template using Symfony's own Twig loader (most accurate fallback). */
async function resolveTwigViaSymfonyCli(projectRoot, templateName) {
    const result = await runSymfonyCommand(projectRoot, [
        "debug:twig",
        templateName,
        "--format=json",
    ]);
    if (!result?.stdout) {
        return null;
    }
    try {
        const data = JSON.parse(result.stdout);
        const matched = data.matched_file;
        if (typeof matched !== "string" ||
            matched.includes("not found") ||
            matched.includes("Template name")) {
            return null;
        }
        return path.isAbsolute(matched)
            ? matched
            : path.join(projectRoot, matched);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=symfonyCli.js.map