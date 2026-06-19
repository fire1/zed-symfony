#!/usr/bin/env node

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixtureRoot = join(root, "..", "fixtures", "symfony-project");

const { projectIndex } = await import(join(root, "dist/index/projectIndex.js"));
const { parseSymfonyStrings } = await import(join(root, "dist/parsers/phpAst.js"));
const { provideDocumentLinks } = await import(join(root, "dist/providers/documentLinks.js"));
const { provideCompletions } = await import(join(root, "dist/providers/completion.js"));
const { resolveTwigTemplate } = await import(join(root, "dist/utils/paths.js"));
const {
  ensurePhpactorConfig,
  resetPhpactorConfigCache,
  mergeMissingConfig,
} = await import(join(root, "dist/utils/phpactorConfig.js"));
const { TextDocument } = await import("vscode-languageserver-textdocument");

const controllerPath = join(fixtureRoot, "src/Controller/HomeController.php");
const statsControllerPath = join(
  fixtureRoot,
  "src/Statistics/Controller/StatisticsController.php"
);
const content = readFileSync(controllerPath, "utf8");
const workControllerPath = join(
  fixtureRoot,
  "src/WorkTackle/Controller/WorkController.php"
);
const workContent = readFileSync(workControllerPath, "utf8");
const uri = `file://${controllerPath}`;

const document = TextDocument.create(uri, "php", 1, content);

console.log("Building index for fixture project...");

resetPhpactorConfigCache();
const phpactorTmp = mkdtempSync(join(tmpdir(), "symfony-phpactor-"));
writeFileSync(
  join(phpactorTmp, ".phpactor.json"),
  JSON.stringify({ "symfony.enabled": false }, null, 2)
);
const mergeResult = ensurePhpactorConfig(phpactorTmp);
const mergedConfig = JSON.parse(readFileSync(join(phpactorTmp, ".phpactor.json"), "utf8"));
rmSync(phpactorTmp, { recursive: true, force: true });
console.log(`  Phpactor auto-config merge: ${mergeResult?.updated ? "updated" : "skipped"}`);
console.log(`  symfony.enabled after merge: ${mergedConfig["symfony.enabled"]}`);

const index = await projectIndex.get(fixtureRoot);

console.log(`  Templates: ${index.twig.templates.length}`);
console.log(`  Namespaces: ${[...index.twig.namespaces.keys()].join(", ")}`);
console.log(`  Routes: ${index.routes.size}`);
console.log(`  Entities: ${index.entities.size}`);
console.log(`  Repositories: ${index.repositories.size}`);

const workEntity = index.entities.get("App\\WorkTackle\\Entity\\WorkTimelineEntity");
console.log(`  WorkTimelineEntity repo: ${workEntity?.repositoryClass ?? "MISSING"}`);

const workRepo = index.repositories.get("App\\WorkTackle\\Repository\\WorkTimelineRepository");
console.log(`  WorkTimelineRepository methods: ${(workRepo?.methods ?? []).join(", ")}`);

const workDoc = TextDocument.create(`file://${workControllerPath}`, "php", 1, workContent);
const workLinks = await provideDocumentLinks(workDoc, index);
const repoMethodLink = workLinks.find((l) =>
  l.tooltip?.includes("findPersonalUserStatistic")
);
console.log(`\nWorkTackle repo method link: ${repoMethodLink?.target ?? "NOT FOUND"}`);

const namespaceResolved = resolveTwigTemplate(
  fixtureRoot,
  "@Statistics/personal/user.twig",
  index.twig
);
console.log(`\n@Statistics/personal/user.twig → ${namespaceResolved ?? "NOT FOUND"}`);

const statsContent = readFileSync(statsControllerPath, "utf8");
const statsLiterals = parseSymfonyStrings(statsContent, statsControllerPath);
console.log(`\nStatistics controller literals: ${statsLiterals.length}`);
for (const lit of statsLiterals) {
  console.log(`  [${lit.kind}] ${lit.value}`);
}

const statsDoc = TextDocument.create(
  `file://${statsControllerPath}`,
  "php",
  1,
  statsContent
);
const statsLinks = await provideDocumentLinks(statsDoc, index);
console.log(`\nStatistics document links: ${statsLinks.length}`);
for (const link of statsLinks) {
  console.log(`  ${link.target}`);
}

const literals = parseSymfonyStrings(content, uri);
console.log(`\nParsed Symfony string literals: ${literals.length}`);
for (const lit of literals) {
  console.log(`  [${lit.kind}] ${lit.value}`);
}

const links = await provideDocumentLinks(document, index);
console.log(`\nDocument links: ${links.length}`);
for (const link of links) {
  console.log(`  ${link.target} (${link.tooltip ?? ""})`);
}

const repoLine = content.split("\n").findIndex((l) => l.includes("findActiveUsers"));
const repoCol = content.split("\n")[repoLine]?.indexOf("findActive") ?? 0;
const completions = provideCompletions(document, index, repoLine, repoCol + 8);
const repoCompletions = completions.filter((c) =>
  ["findActiveUsers", "find", "findAll"].includes(c.label)
);
console.log(`\nRepository completions at getRepository chain: ${repoCompletions.length}`);

const failed = [];
if (!index.twig.namespaces.has("Statistics")) {
  failed.push("Statistics namespace not indexed");
}
if (!namespaceResolved) failed.push("@Statistics template not resolved");
if (statsLinks.length === 0) failed.push("expected Statistics document link");
if (index.twig.templates.length === 0) failed.push("no templates indexed");
if (index.routes.size === 0) failed.push("no routes indexed");
if (index.entities.size === 0) failed.push("no entities indexed");
if (links.length < 2) failed.push("expected >= 2 document links");
if (repoCompletions.length === 0) failed.push("expected repository completions");
if (!workEntity?.repositoryClass?.includes("WorkTimelineRepository")) {
  failed.push("WorkTimelineEntity repository not mapped");
}
if (!repoMethodLink) failed.push("WorkTackle repository method link missing");
if (mergedConfig["symfony.enabled"] !== false) {
  failed.push("phpactor merge overwrote existing symfony.enabled");
}
if (!mergeResult?.updated) {
  failed.push("phpactor merge should add missing keys");
}
if (!mergeMissingConfig({ a: 1 }, { a: 2, b: 3 })) {
  failed.push("mergeMissingConfig should add missing keys");
}

if (failed.length > 0) {
  console.error("\nSmoke test FAILED:", failed.join(", "));
  process.exit(1);
}

console.log("\nSmoke test PASSED");
