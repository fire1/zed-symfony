"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideHover = provideHover;
const phpAst_js_1 = require("../parsers/phpAst.js");
const paths_js_1 = require("../utils/paths.js");
const range_js_1 = require("../utils/range.js");
function provideHover(document, index, line, character) {
    const text = document.getText();
    const literals = (0, phpAst_js_1.parseSymfonyStrings)(text, document.uri);
    for (const literal of literals) {
        const { range } = literal;
        if (line < range.startLine ||
            line > range.endLine ||
            (line === range.startLine && character < range.startCharacter) ||
            (line === range.endLine && character > range.endCharacter)) {
            continue;
        }
        switch (literal.kind) {
            case "twig_template": {
                const resolved = (0, paths_js_1.resolveTwigTemplate)(index.projectRoot, literal.value, index.twig);
                const content = resolved
                    ? `**Twig template**\n\n\`${literal.value}\`\n\n→ ${resolved}`
                    : `**Twig template** (not found)\n\n\`${literal.value}\``;
                return { contents: { kind: "markdown", value: content }, range: (0, range_js_1.toLspRange)(range) };
            }
            case "route_name": {
                const route = index.routes.get(literal.value);
                if (route) {
                    const content = [
                        `**Route:** \`${literal.value}\``,
                        route.path ? `**Path:** \`${route.path}\`` : null,
                        route.controller ? `**Controller:** \`${route.controller}\`` : null,
                    ]
                        .filter(Boolean)
                        .join("\n\n");
                    return { contents: { kind: "markdown", value: content }, range: (0, range_js_1.toLspRange)(range) };
                }
                return {
                    contents: {
                        kind: "markdown",
                        value: `**Route** (unknown): \`${literal.value}\``,
                    },
                    range: (0, range_js_1.toLspRange)(range),
                };
            }
            case "service_id": {
                const service = index.services.get(literal.value);
                if (service) {
                    const content = `**Service:** \`${literal.value}\`\n\n**Class:** \`${service.class}\``;
                    return { contents: { kind: "markdown", value: content }, range: (0, range_js_1.toLspRange)(range) };
                }
                return {
                    contents: {
                        kind: "markdown",
                        value: `**Service** (unknown): \`${literal.value}\``,
                    },
                    range: (0, range_js_1.toLspRange)(range),
                };
            }
            case "entity_class": {
                const entity = index.entities.get(literal.entityClass ?? literal.value);
                if (entity) {
                    const content = [
                        `**Entity:** \`${entity.className}\``,
                        `**Repository:** \`${entity.repositoryClass}\``,
                    ].join("\n\n");
                    return { contents: { kind: "markdown", value: content }, range: (0, range_js_1.toLspRange)(range) };
                }
                return {
                    contents: {
                        kind: "markdown",
                        value: `**Entity:** \`${literal.entityClass ?? literal.value}\``,
                    },
                    range: (0, range_js_1.toLspRange)(range),
                };
            }
        }
    }
    // Hover on repository method after getRepository chain
    const entityToRepo = new Map();
    for (const [className, entity] of index.entities) {
        entityToRepo.set(className, entity.repositoryClass);
    }
    const repoMethod = (0, phpAst_js_1.findRepositoryMethodAtPosition)(text, line, character, entityToRepo);
    if (repoMethod) {
        const repo = index.repositories.get(repoMethod.repositoryClass);
        if (repo?.methods.includes(repoMethod.methodName)) {
            return {
                contents: {
                    kind: "markdown",
                    value: `**${repoMethod.repositoryClass}::${repoMethod.methodName}()**\n\nEntity: \`${repoMethod.entityClass}\``,
                },
                range: (0, range_js_1.toLspRange)(repoMethod.methodRange),
            };
        }
    }
    const chainContext = (0, phpAst_js_1.findRepositoryChainContext)(text, line, character, entityToRepo);
    if (chainContext) {
        const repo = index.repositories.get(chainContext.repositoryClass);
        const methodMatch = text.split("\n")[line]?.slice(0, character).match(/->([\w]+)$/);
        const methodName = methodMatch?.[1];
        if (methodName && repo?.methods.includes(methodName)) {
            return {
                contents: {
                    kind: "markdown",
                    value: `**${chainContext.repositoryClass}::${methodName}()**\n\nEntity: \`${chainContext.entityClass}\``,
                },
            };
        }
    }
    return null;
}
//# sourceMappingURL=hover.js.map