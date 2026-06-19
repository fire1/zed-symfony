"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideCompletions = provideCompletions;
const vscode_languageserver_1 = require("vscode-languageserver");
const phpAst_js_1 = require("../parsers/phpAst.js");
function provideCompletions(document, index, line, character) {
    const items = [];
    const text = document.getText();
    const currentLine = text.split("\n")[line] ?? "";
    const beforeCursor = currentLine.slice(0, character);
    // Twig template completion inside quotes after render(
    if (/->(?:render|renderView|renderBlock)\(\s*['"][^'"]*$/.test(beforeCursor) ||
        /@Template\s*\(\s*['"][^'"]*$/.test(beforeCursor)) {
        for (const template of index.twig.templates) {
            items.push({
                label: template,
                kind: vscode_languageserver_1.CompletionItemKind.File,
                detail: "Twig template",
                insertText: template,
            });
        }
    }
    // Route name completion
    if (/->(?:generateUrl|redirectToRoute|redirect)\(\s*['"][^'"]*$/.test(beforeCursor)) {
        for (const [name, route] of index.routes) {
            items.push({
                label: name,
                kind: vscode_languageserver_1.CompletionItemKind.Reference,
                detail: route.path || route.controller,
                insertText: name,
            });
        }
    }
    // Service id completion
    if (/->container->get\(\s*['"][^'"]*$/.test(beforeCursor)) {
        for (const [id, service] of index.services) {
            items.push({
                label: id,
                kind: vscode_languageserver_1.CompletionItemKind.Module,
                detail: service.class,
                insertText: id,
            });
        }
    }
    // Entity class completion for getRepository
    if (/->getRepository\(\s*[\w\\]*$/.test(beforeCursor)) {
        for (const [className] of index.entities) {
            const shortName = className.split("\\").pop() ?? className;
            items.push({
                label: `${shortName}::class`,
                kind: vscode_languageserver_1.CompletionItemKind.Class,
                detail: className,
                insertText: `${className}::class`,
                insertTextFormat: vscode_languageserver_1.InsertTextFormat.PlainText,
            });
        }
    }
    // Repository method completion after getRepository chain
    const entityToRepo = new Map();
    for (const [className, entity] of index.entities) {
        entityToRepo.set(className, entity.repositoryClass);
    }
    const chainContext = (0, phpAst_js_1.findRepositoryChainContext)(text, line, character, entityToRepo);
    if (chainContext) {
        const repo = index.repositories.get(chainContext.repositoryClass);
        const methods = repo?.methods ?? [];
        const prefix = chainContext.memberPrefix.toLowerCase();
        for (const method of methods) {
            if (!prefix || method.toLowerCase().startsWith(prefix)) {
                items.push({
                    label: method,
                    kind: vscode_languageserver_1.CompletionItemKind.Method,
                    detail: chainContext.repositoryClass,
                    insertText: method,
                });
            }
        }
        // Standard Doctrine repository methods
        const doctrineMethods = [
            "find",
            "findOneBy",
            "findBy",
            "findAll",
            "count",
            "createQueryBuilder",
        ];
        for (const method of doctrineMethods) {
            if (!methods.includes(method) && method.startsWith(prefix || method)) {
                items.push({
                    label: method,
                    kind: vscode_languageserver_1.CompletionItemKind.Method,
                    detail: "Doctrine EntityRepository",
                    insertText: method,
                });
            }
        }
    }
    // If cursor is inside a known string literal, offer completions for that kind
    const literals = (0, phpAst_js_1.parseSymfonyStrings)(text, document.uri);
    for (const literal of literals) {
        const { range } = literal;
        if (line >= range.startLine &&
            line <= range.endLine &&
            character >= range.startCharacter &&
            character <= range.endCharacter) {
            if (literal.kind === "twig_template" && items.length === 0) {
                for (const template of index.twig.templates) {
                    if (template.includes(literal.value) || literal.value === "") {
                        items.push({
                            label: template,
                            kind: vscode_languageserver_1.CompletionItemKind.File,
                            insertText: template,
                        });
                    }
                }
            }
        }
    }
    return items;
}
//# sourceMappingURL=completion.js.map