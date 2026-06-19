"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideDocumentLinks = provideDocumentLinks;
exports.resolveDefinition = resolveDefinition;
const symfonyCli_js_1 = require("../index/symfonyCli.js");
const phpAst_js_1 = require("../parsers/phpAst.js");
const paths_js_1 = require("../utils/paths.js");
const range_js_1 = require("../utils/range.js");
async function resolveTwigPath(index, templateName) {
    const local = (0, paths_js_1.resolveTwigTemplate)(index.projectRoot, templateName, index.twig);
    if (local) {
        return local;
    }
    return (0, symfonyCli_js_1.resolveTwigViaSymfonyCli)(index.projectRoot, templateName);
}
function buildEntityToRepositoryMap(index) {
    const map = new Map();
    for (const [className, entity] of index.entities) {
        map.set(className, entity.repositoryClass);
    }
    return map;
}
function resolveRepositoryMethodDefinition(index, repositoryClass, methodName) {
    const repo = index.repositories.get(repositoryClass);
    if (!repo?.file) {
        return null;
    }
    const line = (0, paths_js_1.findMethodLine)(repo.file, methodName);
    return { uri: (0, paths_js_1.pathToFileUri)(repo.file), line, character: 0 };
}
async function provideDocumentLinks(document, index) {
    const literals = (0, phpAst_js_1.parseSymfonyStrings)(document.getText(), document.uri);
    const links = [];
    const entityToRepo = buildEntityToRepositoryMap(index);
    // Scan all lines for repository method calls (document links on method names)
    const lines = document.getText().split("\n");
    const repoMethodPattern = /getRepository\(\s*([\w\\]+)::class\s*\)(?:->[\w$]+)*->([\w]+)/g;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        repoMethodPattern.lastIndex = 0;
        let match;
        while ((match = repoMethodPattern.exec(line)) !== null) {
            const entityShort = match[1];
            const methodName = match[2];
            const useMap = new Map();
            for (const m of document.getText().matchAll(/^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
                useMap.set(m[2] ?? m[1].split("\\").pop(), m[1]);
            }
            const entityClass = entityShort.includes("\\")
                ? entityShort
                : useMap.get(entityShort) ?? entityShort;
            const repositoryClass = entityToRepo.get(entityClass);
            if (!repositoryClass) {
                continue;
            }
            const def = resolveRepositoryMethodDefinition(index, repositoryClass, methodName);
            if (def) {
                const methodStart = match.index + match[0].lastIndexOf(methodName);
                links.push({
                    range: (0, range_js_1.toLspRange)({
                        startLine: lineNum,
                        startCharacter: methodStart,
                        endLine: lineNum,
                        endCharacter: methodStart + methodName.length,
                    }),
                    target: def.uri,
                    tooltip: `${repositoryClass}::${methodName}()`,
                });
            }
        }
    }
    for (const literal of literals) {
        let target = null;
        let tooltip;
        switch (literal.kind) {
            case "twig_template": {
                const resolved = await resolveTwigPath(index, literal.value);
                if (resolved) {
                    target = (0, paths_js_1.pathToFileUri)(resolved);
                    tooltip = resolved;
                }
                break;
            }
            case "route_name": {
                const route = index.routes.get(literal.value);
                if (route?.controller) {
                    const ref = (0, paths_js_1.parseControllerReference)(route.controller);
                    if (ref) {
                        const file = (0, paths_js_1.resolveClassFile)(index.projectRoot, ref.className);
                        if (file) {
                            target = (0, paths_js_1.pathToFileUri)(file);
                            tooltip = `${route.path} → ${route.controller}`;
                        }
                    }
                }
                break;
            }
            case "service_id": {
                const service = index.services.get(literal.value);
                if (service?.class) {
                    const file = service.file ??
                        (0, paths_js_1.resolveClassFile)(index.projectRoot, service.class);
                    if (file) {
                        target = (0, paths_js_1.pathToFileUri)(file);
                        tooltip = `${literal.value} → ${service.class}`;
                    }
                }
                break;
            }
            case "entity_class": {
                const entity = index.entities.get(literal.entityClass ?? literal.value);
                if (entity?.file) {
                    target = (0, paths_js_1.pathToFileUri)(entity.file);
                    tooltip = entity.className;
                }
                else {
                    const file = (0, paths_js_1.resolveClassFile)(index.projectRoot, literal.entityClass ?? literal.value);
                    if (file) {
                        target = (0, paths_js_1.pathToFileUri)(file);
                    }
                }
                break;
            }
        }
        if (target) {
            links.push({
                range: (0, range_js_1.toLspRange)(literal.range),
                target,
                tooltip,
            });
        }
    }
    return links;
}
async function resolveDefinition(document, index, line, character) {
    const entityToRepo = buildEntityToRepositoryMap(index);
    const repoMethod = (0, phpAst_js_1.findRepositoryMethodAtPosition)(document.getText(), line, character, entityToRepo);
    if (repoMethod) {
        const def = resolveRepositoryMethodDefinition(index, repoMethod.repositoryClass, repoMethod.methodName);
        if (def) {
            return def;
        }
    }
    const literals = (0, phpAst_js_1.parseSymfonyStrings)(document.getText(), document.uri);
    for (const literal of literals) {
        const { range } = literal;
        if (line >= range.startLine &&
            line <= range.endLine &&
            character >= range.startCharacter &&
            character <= range.endCharacter) {
            switch (literal.kind) {
                case "twig_template": {
                    const resolved = await resolveTwigPath(index, literal.value);
                    if (resolved) {
                        return { uri: (0, paths_js_1.pathToFileUri)(resolved), line: 0, character: 0 };
                    }
                    break;
                }
                case "route_name": {
                    const route = index.routes.get(literal.value);
                    if (route?.controller) {
                        const ref = (0, paths_js_1.parseControllerReference)(route.controller);
                        if (ref) {
                            const file = (0, paths_js_1.resolveClassFile)(index.projectRoot, ref.className);
                            if (file) {
                                return {
                                    uri: (0, paths_js_1.pathToFileUri)(file),
                                    line: (0, paths_js_1.findMethodLine)(file, ref.method),
                                    character: 0,
                                };
                            }
                        }
                    }
                    break;
                }
                case "service_id": {
                    const service = index.services.get(literal.value);
                    if (service?.class) {
                        const file = service.file ??
                            (0, paths_js_1.resolveClassFile)(index.projectRoot, service.class);
                        if (file) {
                            return { uri: (0, paths_js_1.pathToFileUri)(file), line: 0, character: 0 };
                        }
                    }
                    break;
                }
                case "entity_class": {
                    const entity = index.entities.get(literal.entityClass ?? literal.value);
                    const file = entity?.file ??
                        (0, paths_js_1.resolveClassFile)(index.projectRoot, literal.entityClass ?? literal.value);
                    if (file) {
                        return { uri: (0, paths_js_1.pathToFileUri)(file), line: 0, character: 0 };
                    }
                    break;
                }
            }
        }
    }
    return null;
}
//# sourceMappingURL=documentLinks.js.map