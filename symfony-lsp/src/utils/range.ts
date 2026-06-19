import { Range, Position } from "vscode-languageserver";

export interface SourceRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export function toLspRange(range: SourceRange): Range {
  return Range.create(
    Position.create(range.startLine, range.startCharacter),
    Position.create(range.endLine, range.endCharacter)
  );
}
