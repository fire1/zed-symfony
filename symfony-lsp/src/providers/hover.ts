import { Hover } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ProjectIndexData } from "../index/projectIndex.js";
import {
  findRepositoryChainContext,
  findRepositoryMethodAtPosition,
  parseSymfonyStrings,
} from "../parsers/phpAst.js";
import { resolveTwigTemplate } from "../utils/paths.js";
import { toLspRange } from "../utils/range.js";

export function provideHover(
  document: TextDocument,
  index: ProjectIndexData,
  line: number,
  character: number
): Hover | null {
  const text = document.getText();
  const literals = parseSymfonyStrings(text, document.uri);

  for (const literal of literals) {
    const { range } = literal;
    if (
      line < range.startLine ||
      line > range.endLine ||
      (line === range.startLine && character < range.startCharacter) ||
      (line === range.endLine && character > range.endCharacter)
    ) {
      continue;
    }

    switch (literal.kind) {
      case "twig_template": {
        const resolved = resolveTwigTemplate(
          index.projectRoot,
          literal.value,
          index.twig
        );
        const content = resolved
          ? `**Twig template**\n\n\`${literal.value}\`\n\n→ ${resolved}`
          : `**Twig template** (not found)\n\n\`${literal.value}\``;
        return { contents: { kind: "markdown", value: content }, range: toLspRange(range) };
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
          return { contents: { kind: "markdown", value: content }, range: toLspRange(range) };
        }
        return {
          contents: {
            kind: "markdown",
            value: `**Route** (unknown): \`${literal.value}\``,
          },
          range: toLspRange(range),
        };
      }
      case "service_id": {
        const service = index.services.get(literal.value);
        if (service) {
          const content = `**Service:** \`${literal.value}\`\n\n**Class:** \`${service.class}\``;
          return { contents: { kind: "markdown", value: content }, range: toLspRange(range) };
        }
        return {
          contents: {
            kind: "markdown",
            value: `**Service** (unknown): \`${literal.value}\``,
          },
          range: toLspRange(range),
        };
      }
      case "entity_class": {
        const entity = index.entities.get(literal.entityClass ?? literal.value);
        if (entity) {
          const content = [
            `**Entity:** \`${entity.className}\``,
            `**Repository:** \`${entity.repositoryClass}\``,
          ].join("\n\n");
          return { contents: { kind: "markdown", value: content }, range: toLspRange(range) };
        }
        return {
          contents: {
            kind: "markdown",
            value: `**Entity:** \`${literal.entityClass ?? literal.value}\``,
          },
          range: toLspRange(range),
        };
      }
    }
  }

  // Hover on repository method after getRepository chain
  const entityToRepo = new Map<string, string>();
  for (const [className, entity] of index.entities) {
    entityToRepo.set(className, entity.repositoryClass);
  }

  const repoMethod = findRepositoryMethodAtPosition(
    text,
    line,
    character,
    entityToRepo
  );
  if (repoMethod) {
    const repo = index.repositories.get(repoMethod.repositoryClass);
    if (repo?.methods.includes(repoMethod.methodName)) {
      return {
        contents: {
          kind: "markdown",
          value: `**${repoMethod.repositoryClass}::${repoMethod.methodName}()**\n\nEntity: \`${repoMethod.entityClass}\``,
        },
        range: toLspRange(repoMethod.methodRange),
      };
    }
  }

  const chainContext = findRepositoryChainContext(
    text,
    line,
    character,
    entityToRepo
  );

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

