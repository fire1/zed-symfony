"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLspRange = toLspRange;
const vscode_languageserver_1 = require("vscode-languageserver");
function toLspRange(range) {
    return vscode_languageserver_1.Range.create(vscode_languageserver_1.Position.create(range.startLine, range.startCharacter), vscode_languageserver_1.Position.create(range.endLine, range.endCharacter));
}
//# sourceMappingURL=range.js.map