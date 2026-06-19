# Symfony LSP

TypeScript language server providing Symfony-specific navigation for PHP files.

## Commands

```bash
npm install
npm run build
npm start   # stdio LSP mode
```

## Smoke test

```bash
node scripts/smoke-test.mjs
```

Runs against the fixture project in `../fixtures/symfony-project/`.

## LSP capabilities

- `textDocument/documentLink` — clickable Twig paths, routes, services, entities
- `textDocument/completion` — templates, routes, services, entities, repository methods
- `textDocument/hover` — Symfony context for string literals
- `textDocument/definition` — fallback navigation for Symfony strings
