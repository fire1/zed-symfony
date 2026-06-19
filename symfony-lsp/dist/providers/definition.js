"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provideDefinition = provideDefinition;
const vscode_languageserver_1 = require("vscode-languageserver");
const documentLinks_js_1 = require("./documentLinks.js");
async function provideDefinition(document, index, line, character) {
    const result = await (0, documentLinks_js_1.resolveDefinition)(document, index, line, character);
    if (!result) {
        return null;
    }
    return vscode_languageserver_1.Location.create(result.uri, vscode_languageserver_1.Range.create(vscode_languageserver_1.Position.create(result.line, result.character), vscode_languageserver_1.Position.create(result.line, result.character)));
}
//# sourceMappingURL=definition.js.map