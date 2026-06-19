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
exports.setPhpactorConfigChangeHandler = setPhpactorConfigChangeHandler;
exports.mergeMissingConfig = mergeMissingConfig;
exports.findSymfonyContainerXml = findSymfonyContainerXml;
exports.recommendedPhpactorConfig = recommendedPhpactorConfig;
exports.isAutoPhpactorConfigEnabled = isAutoPhpactorConfigEnabled;
exports.ensurePhpactorConfig = ensurePhpactorConfig;
exports.resetPhpactorConfigCache = resetPhpactorConfigCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_EXCLUDE_PATTERNS = [
    "/vendor/**/Tests/**/*",
    "/vendor/**/tests/**/*",
    "/var/cache/**/*",
    "/vendor/composer/**/*",
];
const ensuredProjects = new Set();
let onConfigChanged = null;
function setPhpactorConfigChangeHandler(handler) {
    onConfigChanged = handler;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Add keys from `defaults` only where `target` has no value yet. */
function mergeMissingConfig(target, defaults) {
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in target)) {
            target[key] = value;
            changed = true;
            continue;
        }
        const existing = target[key];
        if (isRecord(value) && isRecord(existing)) {
            if (mergeMissingConfig(existing, value)) {
                changed = true;
            }
        }
    }
    return changed;
}
function findSymfonyContainerXml(projectRoot) {
    const cacheDir = path.join(projectRoot, "var", "cache", "dev");
    if (!fs.existsSync(cacheDir)) {
        return null;
    }
    let entries;
    try {
        entries = fs.readdirSync(cacheDir);
    }
    catch {
        return null;
    }
    const containerFiles = entries.filter((name) => name.endsWith("Container.xml"));
    if (containerFiles.length === 0) {
        return null;
    }
    const preferred = containerFiles.find((name) => name.includes("Debug")) ?? containerFiles[0];
    return path.join("var", "cache", "dev", preferred);
}
function recommendedPhpactorConfig(projectRoot) {
    const config = {
        $schema: "/phpactor.schema.json",
        "symfony.enabled": true,
        "indexer.exclude_patterns": DEFAULT_EXCLUDE_PATTERNS,
    };
    const xmlPath = findSymfonyContainerXml(projectRoot);
    if (xmlPath) {
        config["symfony.xml_path"] = xmlPath;
    }
    return config;
}
function isAutoPhpactorConfigEnabled() {
    const flag = process.env.SYMFONY_LSP_AUTO_PHPACTOR_CONFIG?.trim().toLowerCase();
    if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
        return false;
    }
    return true;
}
/**
 * Create or merge recommended Phpactor settings for a Symfony project.
 * Never overwrites keys the user already configured.
 */
function ensurePhpactorConfig(projectRoot) {
    if (!isAutoPhpactorConfigEnabled()) {
        return null;
    }
    if (ensuredProjects.has(projectRoot)) {
        return null;
    }
    ensuredProjects.add(projectRoot);
    const configPath = path.join(projectRoot, ".phpactor.json");
    const recommended = recommendedPhpactorConfig(projectRoot);
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${JSON.stringify(recommended, null, 2)}\n`, "utf8");
        const result = { path: configPath, created: true, updated: false };
        onConfigChanged?.(result);
        return result;
    }
    try {
        const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (!isRecord(existing)) {
            return null;
        }
        const merged = { ...existing };
        const changed = mergeMissingConfig(merged, recommended);
        if (!changed) {
            return null;
        }
        fs.writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        const result = { path: configPath, created: false, updated: true };
        onConfigChanged?.(result);
        return result;
    }
    catch {
        return null;
    }
}
/** @internal test helper */
function resetPhpactorConfigCache() {
    ensuredProjects.clear();
}
//# sourceMappingURL=phpactorConfig.js.map