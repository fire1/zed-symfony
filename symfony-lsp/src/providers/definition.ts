import { Location, Position, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ProjectIndexData } from "../index/projectIndex.js";
import { resolveDefinition as resolveSymfonyDefinition } from "./documentLinks.js";

export async function provideDefinition(
  document: TextDocument,
  index: ProjectIndexData,
  line: number,
  character: number
): Promise<Location | null> {
  const result = await resolveSymfonyDefinition(document, index, line, character);
  if (!result) {
    return null;
  }

  return Location.create(
    result.uri,
    Range.create(
      Position.create(result.line, result.character),
      Position.create(result.line, result.character)
    )
  );
}
