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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRepositoryMethods = extractRepositoryMethods;
exports.resolveRepositoryClassName = resolveRepositoryClassName;
exports.indexEntityFile = indexEntityFile;
exports.indexDoctrineMappingsFromYaml = indexDoctrineMappingsFromYaml;
exports.indexRepositoryFiles = indexRepositoryFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const yaml_1 = require("yaml");
const paths_js_1 = require("../utils/paths.js");
function extractRepositoryMethods(content) {
    return [...content.matchAll(/function\s+(\w+)\s*\(/g)]
        .map((m) => m[1])
        .filter((m) => !m.startsWith("__") &&
        m !== "getEntityClass" &&
        m !== "getClassName");
}
function resolveRepositoryClassName(entityNamespace, entityShortName, content, projectRoot) {
    const repoAttrMatch = content.match(/repositoryClass:\s*([\w\\]+(?:::class)?|'[^']+'|"[^"]+")/);
    if (repoAttrMatch) {
        let repositoryClass = repoAttrMatch[1]
            .replace(/::class$/, "")
            .replace(/^['"]|['"]$/g, "");
        if (!repositoryClass.includes("\\")) {
            const useMatch = content.match(new RegExp(`^use\\s+([\\w\\\\]+(?:\\\\${repositoryClass}))\\s*;`, "m"));
            if (useMatch) {
                repositoryClass = useMatch[1];
            }
            else {
                repositoryClass = `${entityNamespace}\\${repositoryClass}`;
            }
        }
        return repositoryClass;
    }
    // Symfony convention: App\Foo\Entity\Bar → App\Foo\Repository\BarRepository
    if (entityNamespace.endsWith("\\Entity")) {
        const repoNamespace = entityNamespace.replace(/\\Entity$/, "\\Repository");
        const conventional = `${repoNamespace}\\${entityShortName}Repository`;
        if ((0, paths_js_1.resolveClassFile)(projectRoot, conventional)) {
            return conventional;
        }
    }
    // Same namespace as entity: App\Foo\Bar → App\Foo\BarRepository
    const sameNs = `${entityNamespace}\\${entityShortName}Repository`;
    if ((0, paths_js_1.resolveClassFile)(projectRoot, sameNs)) {
        return sameNs;
    }
    // Parent namespace: App\WorkTackle\Entity\X → App\WorkTackle\XRepository
    const parentNs = entityNamespace.replace(/\\[^\\]+$/, "");
    const parentCandidate = `${parentNs}\\${entityShortName}Repository`;
    if ((0, paths_js_1.resolveClassFile)(projectRoot, parentCandidate)) {
        return parentCandidate;
    }
    return sameNs;
}
function indexEntityFile(projectRoot, file, content) {
    if (!/#\[ORM\\Entity|@ORM\\Entity/.test(content)) {
        return null;
    }
    const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
    const classMatch = content.match(/(?:class|interface)\s+(\w+)/);
    if (!namespaceMatch || !classMatch) {
        return null;
    }
    const className = `${namespaceMatch[1]}\\${classMatch[1]}`;
    const repositoryClass = resolveRepositoryClassName(namespaceMatch[1], classMatch[1], content, projectRoot);
    return { className, repositoryClass };
}
async function indexDoctrineMappingsFromYaml(projectRoot) {
    const entityToRepo = new Map();
    const yamlFiles = await (0, fast_glob_1.default)(["config/packages/doctrine.{yaml,yml}", "config/doctrine/**/*.{yaml,yml}"], { cwd: projectRoot, absolute: true });
    for (const yamlFile of yamlFiles) {
        try {
            const doc = (0, yaml_1.parse)(fs.readFileSync(yamlFile, "utf8"));
            collectYamlMappings(doc, entityToRepo);
        }
        catch {
            // ignore
        }
    }
    return entityToRepo;
}
function collectYamlMappings(node, entityToRepo) {
    if (!node || typeof node !== "object") {
        return;
    }
    if (Array.isArray(node)) {
        for (const item of node) {
            collectYamlMappings(item, entityToRepo);
        }
        return;
    }
    const record = node;
    // doctrine.orm.entity_manager.mappings.*.type: attribute
    // entity entry with repositoryClass
    if (typeof record.repositoryClass === "string") {
        // handled at entity level in parent key
    }
    for (const [key, value] of Object.entries(record)) {
        if (value && typeof value === "object") {
            const entry = value;
            if (typeof entry.repositoryClass === "string" && key.includes("\\")) {
                entityToRepo.set(key, entry.repositoryClass.replace(/::class$/, ""));
            }
            else if (typeof entry.repositoryClass === "string" &&
                typeof entry.class === "string") {
                entityToRepo.set(entry.class, entry.repositoryClass.replace(/::class$/, ""));
            }
            collectYamlMappings(value, entityToRepo);
        }
    }
}
async function indexRepositoryFiles(projectRoot) {
    const repositories = new Map();
    const repoFiles = await (0, fast_glob_1.default)("src/**/*Repository.php", {
        cwd: projectRoot,
        ignore: ["vendor/**"],
    });
    for (const relPath of repoFiles) {
        const file = path.join(projectRoot, relPath);
        const content = fs.readFileSync(file, "utf8");
        const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
        const classMatch = content.match(/class\s+(\w+Repository)/);
        if (!namespaceMatch || !classMatch) {
            continue;
        }
        const className = `${namespaceMatch[1]}\\${classMatch[1]}`;
        const methods = extractRepositoryMethods(content);
        let entityClass;
        const entityTypeMatch = content.match(/extends\s+ServiceEntityRepository<([^>]+)>/);
        if (entityTypeMatch) {
            entityClass = entityTypeMatch[1].trim().replace(/::class$/, "");
        }
        else {
            const constructorMatch = content.match(/parent::__construct\(\$registry,\s*([\w\\]+)::class/);
            if (constructorMatch) {
                entityClass = constructorMatch[1];
            }
        }
        repositories.set(className, {
            className,
            file,
            methods,
            entityClass,
        });
    }
    return repositories;
}
//# sourceMappingURL=doctrineIndex.js.map