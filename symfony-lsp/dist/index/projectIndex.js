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
exports.projectIndex = exports.ProjectIndex = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const yaml_1 = require("yaml");
const symfonyCli_js_1 = require("./symfonyCli.js");
const paths_js_1 = require("../utils/paths.js");
const phpactorConfig_js_1 = require("../utils/phpactorConfig.js");
const doctrineIndex_js_1 = require("./doctrineIndex.js");
class ProjectIndex {
    cache = new Map();
    refreshTimers = new Map();
    async get(projectRoot) {
        const existing = this.cache.get(projectRoot);
        if (existing && Date.now() - existing.indexedAt < 60_000) {
            return existing;
        }
        const data = await this.build(projectRoot);
        this.cache.set(projectRoot, data);
        return data;
    }
    invalidate(projectRoot) {
        this.cache.delete(projectRoot);
        const timer = this.refreshTimers.get(projectRoot);
        if (timer) {
            clearTimeout(timer);
        }
        this.refreshTimers.set(projectRoot, setTimeout(() => {
            this.cache.delete(projectRoot);
            this.refreshTimers.delete(projectRoot);
        }, 500));
    }
    async build(projectRoot) {
        (0, phpactorConfig_js_1.ensurePhpactorConfig)(projectRoot);
        const [twig, routes, services, { entities, repositories }] = await Promise.all([
            this.indexTwig(projectRoot),
            this.indexRoutes(projectRoot),
            this.indexServices(projectRoot),
            this.indexDoctrine(projectRoot),
        ]);
        return {
            projectRoot,
            twig,
            routes,
            services,
            entities,
            repositories,
            indexedAt: Date.now(),
        };
    }
    async indexTwig(projectRoot) {
        const loaderPaths = [];
        const templates = [];
        const namespaces = new Map();
        const addNamespace = (namespace, dirPath) => {
            const ns = namespace.replace(/^@/, "").replace(/Bundle$/, "");
            if (!ns || ns === "(None)") {
                loaderPaths.push(dirPath);
                return;
            }
            const existing = namespaces.get(ns) ?? [];
            if (!existing.includes(dirPath)) {
                existing.push(dirPath);
                namespaces.set(ns, existing);
            }
        };
        const result = await (0, symfonyCli_js_1.runSymfonyCommand)(projectRoot, [
            "debug:twig",
            "--format=json",
        ]);
        if (result?.stdout) {
            try {
                const data = JSON.parse(result.stdout);
                if (data.loader_paths && typeof data.loader_paths === "object") {
                    for (const [ns, paths] of Object.entries(data.loader_paths)) {
                        const pathList = Array.isArray(paths) ? paths : [paths];
                        for (const p of pathList) {
                            if (typeof p !== "string") {
                                continue;
                            }
                            const abs = (0, paths_js_1.expandSymfonyPath)(p, projectRoot);
                            if (ns === "(None)" || ns === "@(None)") {
                                loaderPaths.push(abs);
                            }
                            else {
                                addNamespace(ns, abs);
                            }
                        }
                    }
                }
                if (Array.isArray(data.paths)) {
                    for (const entry of data.paths) {
                        if (typeof entry === "string") {
                            templates.push(entry);
                        }
                        else if (entry?.name) {
                            templates.push(entry.name);
                        }
                    }
                }
            }
            catch {
                // fall through to static indexing
            }
        }
        if (loaderPaths.length === 0) {
            loaderPaths.push(path.join(projectRoot, "templates"), path.join(projectRoot, "templates", "bundles"));
        }
        const twigConfigFiles = [
            path.join(projectRoot, "config", "packages", "twig.yaml"),
            path.join(projectRoot, "config", "packages", "twig.yml"),
        ];
        for (const twigYaml of twigConfigFiles) {
            if (!fs.existsSync(twigYaml)) {
                continue;
            }
            try {
                const doc = (0, yaml_1.parse)(fs.readFileSync(twigYaml, "utf8"));
                const paths = doc?.twig?.paths ?? doc?.paths;
                if (paths && typeof paths === "object") {
                    for (const [dirPath, namespace] of Object.entries(paths)) {
                        const abs = (0, paths_js_1.expandSymfonyPath)(dirPath, projectRoot);
                        if (namespace && typeof namespace === "string") {
                            addNamespace(namespace, abs);
                        }
                        else {
                            loaderPaths.push(abs);
                        }
                    }
                }
                const defaultPath = doc?.twig?.default_path;
                if (defaultPath) {
                    loaderPaths.push((0, paths_js_1.expandSymfonyPath)(defaultPath, projectRoot));
                }
            }
            catch {
                // ignore
            }
        }
        // Domain / bundle structure: src/Statistics/Resources/views → @Statistics
        const bundleViewDirs = await (0, fast_glob_1.default)("src/**/Resources/views", {
            cwd: projectRoot,
            onlyDirectories: true,
            ignore: ["vendor/**", "var/**", "node_modules/**"],
        });
        for (const relDir of bundleViewDirs) {
            const absDir = path.join(projectRoot, relDir);
            const match = relDir.match(/^src\/([^/]+)\/Resources\/views$/);
            if (match) {
                const segment = match[1].replace(/Bundle$/, "");
                addNamespace(segment, absDir);
            }
        }
        // Build logical template names (@Statistics/foo.twig) for completion
        for (const [namespace, roots] of namespaces) {
            for (const viewsRoot of roots) {
                if (!fs.existsSync(viewsRoot)) {
                    continue;
                }
                const files = await (0, fast_glob_1.default)("**/*.twig", {
                    cwd: viewsRoot,
                    onlyFiles: true,
                });
                for (const file of files) {
                    templates.push(`@${namespace}/${file.replace(/\\/g, "/")}`);
                }
            }
        }
        const templateFiles = await (0, fast_glob_1.default)("**/*.twig", {
            cwd: projectRoot,
            ignore: ["vendor/**", "var/**", "node_modules/**"],
        });
        for (const file of templateFiles) {
            templates.push(file.replace(/\\/g, "/"));
        }
        return {
            loaderPaths: [...new Set(loaderPaths)],
            templates: [...new Set(templates)],
            namespaces,
        };
    }
    async indexRoutes(projectRoot) {
        const routes = new Map();
        const result = await (0, symfonyCli_js_1.runSymfonyCommand)(projectRoot, [
            "debug:router",
            "--format=json",
        ]);
        if (result?.stdout) {
            try {
                const data = JSON.parse(result.stdout);
                for (const [name, info] of Object.entries(data)) {
                    if (name.startsWith("_")) {
                        continue;
                    }
                    const route = info;
                    const controller = route.defaults?._controller ?? "";
                    const pathParams = (route.path ?? "").match(/\{(\w+)\}/g)?.map((p) => p.slice(1, -1)) ?? [];
                    routes.set(name, {
                        name,
                        path: route.path ?? "",
                        controller,
                        pathParams,
                    });
                }
                return routes;
            }
            catch {
                // fall through
            }
        }
        // Fallback: scan PHP attributes
        const controllerFiles = await (0, fast_glob_1.default)("src/**/*.php", {
            cwd: projectRoot,
            ignore: ["vendor/**"],
        });
        for (const file of controllerFiles) {
            const content = fs.readFileSync(path.join(projectRoot, file), "utf8");
            const routeAttrRegex = /#\[Route\([^)]*name:\s*['"]([^'"]+)['"][^)]*\)[^\n]*\n\s*public\s+function\s+(\w+)/gs;
            let match;
            while ((match = routeAttrRegex.exec(content)) !== null) {
                const classMatch = content.match(/namespace\s+([\w\\]+)/);
                const classNameMatch = content.match(/class\s+(\w+)/);
                if (classMatch && classNameMatch) {
                    const controller = `${classMatch[1]}\\${classNameMatch[1]}::${match[2]}`;
                    routes.set(match[1], {
                        name: match[1],
                        path: "",
                        controller,
                        pathParams: [],
                    });
                }
            }
        }
        return routes;
    }
    async indexServices(projectRoot) {
        const services = new Map();
        const result = await (0, symfonyCli_js_1.runSymfonyCommand)(projectRoot, [
            "debug:container",
            "--format=json",
            "--show-private",
        ]);
        if (result?.stdout) {
            try {
                const data = JSON.parse(result.stdout);
                for (const [id, info] of Object.entries(data)) {
                    const svc = info;
                    if (svc.class) {
                        services.set(id, {
                            id,
                            class: svc.class,
                            file: svc.file,
                        });
                    }
                }
                return services;
            }
            catch {
                // fall through
            }
        }
        // Fallback: parse container XML
        const { findContainerXml } = await Promise.resolve().then(() => __importStar(require("./symfonyCli.js")));
        const xmlPath = findContainerXml(projectRoot);
        if (xmlPath && fs.existsSync(xmlPath)) {
            const xml = fs.readFileSync(xmlPath, "utf8");
            const serviceRegex = /<service\s+id="([^"]+)"[^>]*class="([^"]+)"[^>]*\/?>/g;
            let match;
            while ((match = serviceRegex.exec(xml)) !== null) {
                services.set(match[1], { id: match[1], class: match[2] });
            }
            const serviceRegex2 = /<service\s+id="([^"]+)"[^>]*>\s*<tag[^>]*\/>?\s*<\/service>/g;
            // Also match services with class attribute in different order
            const altRegex = /<service\s+([^>]+)\/?>/g;
            while ((match = altRegex.exec(xml)) !== null) {
                const attrs = match[1];
                const idMatch = attrs.match(/id="([^"]+)"/);
                const classMatch = attrs.match(/class="([^"]+)"/);
                if (idMatch && classMatch) {
                    services.set(idMatch[1], {
                        id: idMatch[1],
                        class: classMatch[1],
                    });
                }
            }
        }
        return services;
    }
    async indexDoctrine(projectRoot) {
        const entities = new Map();
        const repositories = new Map();
        const yamlEntityRepos = await (0, doctrineIndex_js_1.indexDoctrineMappingsFromYaml)(projectRoot);
        const scannedRepos = await (0, doctrineIndex_js_1.indexRepositoryFiles)(projectRoot);
        // Index all PHP files with ORM\Entity (not only src/**/Entity/**)
        const entityFiles = await (0, fast_glob_1.default)("src/**/*.php", {
            cwd: projectRoot,
            ignore: ["vendor/**", "**/*Repository.php"],
        });
        for (const relPath of entityFiles) {
            const file = path.join(projectRoot, relPath);
            const content = fs.readFileSync(file, "utf8");
            const indexed = (0, doctrineIndex_js_1.indexEntityFile)(projectRoot, file, content);
            if (!indexed) {
                continue;
            }
            let { className, repositoryClass } = indexed;
            if (yamlEntityRepos.has(className)) {
                repositoryClass = yamlEntityRepos.get(className);
            }
            // Link entity from repository scan (ServiceEntityRepository<Entity>)
            for (const repo of scannedRepos.values()) {
                if (repo.entityClass === className) {
                    repositoryClass = repo.className;
                    break;
                }
            }
            const entity = { className, file, repositoryClass };
            entities.set(className, entity);
            let repoInfo = scannedRepos.get(repositoryClass);
            let repoFile = repoInfo?.file ?? (0, paths_js_1.resolveClassFile)(projectRoot, repositoryClass);
            if (repoFile && !repoInfo) {
                const repoContent = fs.readFileSync(repoFile, "utf8");
                repoInfo = {
                    className: repositoryClass,
                    file: repoFile,
                    methods: (0, doctrineIndex_js_1.extractRepositoryMethods)(repoContent),
                    entityClass: className,
                };
            }
            if (repoFile && repoInfo) {
                entity.repositoryFile = repoFile;
                repositories.set(repositoryClass, {
                    className: repositoryClass,
                    file: repoFile,
                    methods: repoInfo.methods,
                    entityClass: className,
                });
            }
        }
        // Register repositories not linked to entities yet
        for (const repo of scannedRepos.values()) {
            if (!repositories.has(repo.className)) {
                repositories.set(repo.className, repo);
            }
            if (repo.entityClass && !entities.has(repo.entityClass)) {
                entities.set(repo.entityClass, {
                    className: repo.entityClass,
                    file: (0, paths_js_1.resolveClassFile)(projectRoot, repo.entityClass) ?? "",
                    repositoryClass: repo.className,
                    repositoryFile: repo.file,
                });
            }
        }
        return { entities, repositories };
    }
}
exports.ProjectIndex = ProjectIndex;
exports.projectIndex = new ProjectIndex();
//# sourceMappingURL=projectIndex.js.map