"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offsetAtLine = offsetAtLine;
exports.classAtCursor = classAtCursor;
const php_parser_1 = require("php-parser");
const composer_js_1 = require("../utils/composer.js");
const engine = new php_parser_1.Engine({
    parser: {
        extractDoc: true,
        suppressErrors: true,
    },
    ast: {
        withPositions: true,
    },
});
function offsetAtLine(content, line, character) {
    const lines = content.split("\n");
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }
    return offset + character;
}
function locToRange(loc) {
    return {
        startLine: loc.start.line - 1,
        startCharacter: loc.start.column,
        endLine: loc.end.line - 1,
        endCharacter: loc.end.column,
    };
}
function offsetInLoc(content, loc, offset) {
    const start = offsetAtLine(content, loc.start.line - 1, loc.start.column);
    const end = offsetAtLine(content, loc.end.line - 1, loc.end.column);
    return offset >= start && offset <= end;
}
function getNamespace(ast) {
    for (const child of ast?.children ?? []) {
        if (child?.kind !== "namespace") {
            continue;
        }
        const nameNode = child.name;
        if (nameNode?.kind === "identifier") {
            return nameNode.name;
        }
        if (typeof nameNode === "string") {
            return nameNode;
        }
    }
    return null;
}
function findDeclarationAtOffset(node, content, offset) {
    if (!node || typeof node !== "object") {
        return null;
    }
    if (node.kind === "class" ||
        node.kind === "interface" ||
        node.kind === "trait") {
        const nameNode = node.id ?? node.name;
        const name = nameNode?.name;
        if (name && nameNode?.loc && offsetInLoc(content, nameNode.loc, offset)) {
            return { name, range: locToRange(nameNode.loc) };
        }
    }
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                const found = findDeclarationAtOffset(item, content, offset);
                if (found) {
                    return found;
                }
            }
        }
        else if (child && typeof child === "object") {
            const found = findDeclarationAtOffset(child, content, offset);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function isEligibleDeclaration(fqcn, filePath, projectRoot) {
    const mappedFqcn = (0, composer_js_1.fqcnFromFilePath)(filePath, projectRoot);
    const resolvedPath = (0, composer_js_1.filePathFromFqcn)(fqcn, projectRoot);
    return Boolean(resolvedPath && mappedFqcn === fqcn);
}
function classAtCursor(content, filePath, projectRoot, line, character) {
    if ((0, composer_js_1.isDependencyPath)(filePath, projectRoot)) {
        return null;
    }
    const byteOffset = offsetAtLine(content, line, character);
    let ast;
    try {
        ast = engine.parseCode(content, filePath);
    }
    catch {
        return classAtCursorRegex(content, filePath, projectRoot, line, character);
    }
    const namespace = getNamespace(ast);
    if (!namespace) {
        return null;
    }
    const declaration = findDeclarationAtOffset(ast, content, byteOffset);
    if (!declaration) {
        return classAtCursorRegex(content, filePath, projectRoot, line, character);
    }
    const fqcn = `${namespace}\\${declaration.name}`;
    if (!isEligibleDeclaration(fqcn, filePath, projectRoot)) {
        return null;
    }
    return {
        fqcn,
        basename: declaration.name,
        declPath: filePath,
        range: declaration.range,
    };
}
function classAtCursorRegex(content, filePath, projectRoot, line, character) {
    const namespaceMatch = content.match(/^namespace\s+([\w\\]+)\s*;/m);
    if (!namespaceMatch) {
        return null;
    }
    const namespace = namespaceMatch[1];
    const currentLine = content.split("\n")[line] ?? "";
    const pattern = /\b(class|interface|trait)\s+(\w+)/g;
    let match;
    while ((match = pattern.exec(currentLine)) !== null) {
        const name = match[2];
        const nameStart = match.index + match[0].indexOf(name);
        const nameEnd = nameStart + name.length;
        if (character >= nameStart && character <= nameEnd) {
            const fqcn = `${namespace}\\${name}`;
            if (!isEligibleDeclaration(fqcn, filePath, projectRoot)) {
                return null;
            }
            return {
                fqcn,
                basename: name,
                declPath: filePath,
                range: {
                    startLine: line,
                    startCharacter: nameStart,
                    endLine: line,
                    endCharacter: nameEnd,
                },
            };
        }
    }
    return null;
}
//# sourceMappingURL=classAtCursor.js.map