# Symfony for Zed

> **Prototype / beta (v0.1.0)** — early extension for Symfony projects in [Zed](https://zed.dev).  
> Expect rough edges, missing features, and breaking changes. Feedback and issues welcome on [GitHub](https://github.com/fire1/zed-symfony).

Symfony framework navigation for Zed, designed to run **alongside a PHP language server** — typically [Phpactor](https://phpactor.readthedocs.io) via the official [PHP extension](https://github.com/zed-extensions/php).

## Status: what works

| Feature | Status | Notes |
|---------|--------|-------|
| Twig template links | ✅ Works | `render()`, `renderView()`, `@Template`, `@Namespace/path.twig` |
| Route links | ✅ Works | `generateUrl()`, `redirectToRoute()` |
| Service container links | ✅ Works | `$this->container->get('service.id')` |
| Doctrine repository resolution | ✅ Works | Entity → `Repository` namespace convention, `*Repository.php` scan |
| Repository method links | ✅ Works | Ctrl/Cmd+click on custom method after `getRepository(Entity::class)->` |
| Repository method completion | ✅ Works | After `getRepository(...)->` |
| Repository method hover | ✅ Works | Shows concrete repository class |
| Auto `.phpactor.json` merge | ✅ Works | On workspace open; adds missing keys only |
| Phpactor custom repo diagnostics | ⚠️ Known issue | See [Phpactor + Doctrine](#phpactor--doctrine) below |

Indexed from Symfony CLI (`debug:twig`, `debug:router`, `debug:container`) with static fallbacks when CLI is unavailable.

## Is Phpactor required?

**No — but strongly recommended.**

| Component | Required? | Role |
|-----------|-----------|------|
| **Symfony LSP** (this extension) | Yes | Twig, routes, services, Doctrine repository navigation |
| **Phpactor** (PHP extension) | No, but recommended | General PHP: classes, methods, refactoring, diagnostics |
| **Node.js** | Yes | Runs the Symfony LSP server |
| **Symfony dev cache** | Recommended | `cache:clear` in dev mode for route/service index |

Symfony LSP does **not** replace a PHP language server. Without Phpactor (or another PHP LSP), you get Symfony-specific links and completion only — no general PHP intelligence.

This extension is built and tested to run **with** Phpactor. Other PHP servers (e.g. Intelephense) may work alongside Symfony LSP, but are not the primary target.

```json
{
  "languages": {
    "PHP": {
      "language_servers": ["phpactor", "symfony-lsp", "!intelephense", "!phptools"]
    }
  }
}
```

**LSP order:** Symfony LSP does **not** override or remove Phpactor diagnostics. Order mainly affects go-to-definition priority. Keep `phpactor` first for normal PHP navigation; Symfony LSP adds framework links on top.

## Architecture

```
Zed PHP buffer
    ├── Phpactor      → general PHP (classes, methods, refactor, diagnostics)
    └── Symfony LSP   → framework strings (document links, completion, hover)
```

Symfony features use **`textDocument/documentLink`** so they do not conflict with Phpactor's go-to-definition priority.

## Requirements

- [Zed](https://zed.dev)
- [PHP extension](https://github.com/zed-extensions/php) with Phpactor (recommended)
- [Node.js](https://nodejs.org) 18+
- PHP + Symfony project with warmed dev cache

## Installation

### From source (dev extension)

1. Clone and build:

```bash
git clone git@github.com:fire1/zed-symfony.git
cd zed-symfony
npm install
npm run setup-zed
```

This copies the bundled server to `~/.local/share/zed/extensions/work/symfony-fire1/symfony-lsp-server.js`. **Required** — Zed runs the WASM from that folder only, not your source tree.

2. In Zed: Command Palette → **zed: extensions** → **Install Dev Extension** → select this directory.

3. **Restart Zed**

4. Configure Zed settings (`settings.json`) as shown above.

### Phpactor Symfony container (recommended)

When you open a Symfony project, **Symfony LSP** automatically creates or merges `.phpactor.json` in the project root when Zed starts (and again on first index). It only adds **missing** keys — your existing settings are never overwritten.

**Requirements:** your Symfony app must be inside the Zed workspace (open the Symfony project folder, or a parent folder that contains it). After updating the extension, run `npm run setup-zed` once, then restart Zed.

Typical merged settings:

```json
{
  "$schema": "/phpactor.schema.json",
  "symfony.enabled": true,
  "symfony.xml_path": "var/cache/dev/App_KernelDevDebugContainer.xml",
  "indexer.exclude_patterns": [
    "/vendor/**/Tests/**/*",
    "/vendor/**/tests/**/*",
    "/var/cache/**/*",
    "/vendor/composer/**/*"
  ]
}
```

The container XML path is auto-detected from `var/cache/dev/*Container.xml` when the dev cache exists. After the file is created or updated, **restart Phpactor** (reload window or restart Zed) so it picks up the config.

Disable auto-setup with:

```bash
export SYMFONY_LSP_AUTO_PHPACTOR_CONFIG=0
```

Or copy [`.phpactor.json.example`](.phpactor.json.example) manually if you prefer full control.

Warm the Symfony cache:

```bash
./bin/console cache:clear
```

## Usage

| Pattern | Feature |
|---------|---------|
| `$this->render('foo.html.twig')` | Clickable link to template file |
| `$this->generateUrl('app_home')` | Link to controller action |
| `$this->container->get('mailer')` | Link to service class |
| `$em->getRepository(User::class)->` | Completion for custom repository methods |

Use **Cmd/Ctrl+click** on underlined string literals (document links). Hover for route paths, service classes, and entity/repository info.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No Symfony features | Ensure project has `composer.json` with `symfony/*` packages |
| Empty service/route index | Run `./bin/console cache:clear` in dev mode |
| LSP not starting / "not found at symfony-lsp/dist/server.js" | Run `npm run setup-zed` from extension root, then restart Zed |
| Twig path not resolved | Verify template exists under `templates/` or paths in `config/packages/twig.yaml` |
| Red underline on custom repository methods | **Phpactor** error — Symfony LSP adds links/completion but cannot remove Phpactor diagnostics. See [Phpactor + Doctrine](#phpactor--doctrine) |
| Log says `/var/www/...` but project is `/home/...` | Same directory via symlink/mount — normal on some setups |

### Phpactor + Doctrine (known limitation)

**The problem:** Phpactor types `EntityManager::getRepository()` as `ObjectRepository<Entity>`, which only includes base Doctrine methods (`find`, `findOneBy`, …). Custom repository methods like `findPersonalUserStatistic()` are valid at runtime but Phpactor reports:

```
Method "findPersonalUserStatistic" does not exist on interface
"Doctrine\Persistence\ObjectRepository<App\...\WorkTimelineEntity>"
```

Diagnostic code: `worse.missing_member`

**What Symfony LSP does (partial fix):**

- Resolves the concrete repository class (`Entity` → `Repository` namespace)
- Ctrl/Cmd+click on the method name → jumps to `WorkTimelineRepository.php`
- Completion after `getRepository(...)->`
- Hover with repository class info

**What Symfony LSP cannot do:** remove or override Phpactor's red underlines. That is a separate language server.

**Workarounds for Phpactor diagnostics:**

```php
/** @var \App\WorkTackle\Repository\WorkTimelineRepository $repo */
$repo = $this->em()->getRepository(WorkTimelineEntity::class);
$repo->findPersonalUserStatistic($user, $date);
```

Or inject the repository directly instead of using `getRepository()`.

To silence the diagnostic globally in `.phpactor.json` (hides *all* missing-member warnings):

```json
{
  "language_server.diagnostic_ignore_codes": ["worse.missing_member"]
}
```

Other options: [`phpstan/phpstan-doctrine`](https://github.com/phpstan/phpstan-doctrine), Phpactor additive stubs.

## Development

```bash
# Rebuild LSP after TypeScript changes
npm run build

# Rebuild Zed WASM extension
cargo build --target wasm32-wasip2 --release

# Install into Zed work directory
npm run setup-zed

# Run LSP smoke test against fixture project
node symfony-lsp/scripts/smoke-test.mjs
```

## Publishing to Zed marketplace

1. Ensure `symfony-lsp/dist/server.bundle.js` is built and committed.
2. Open a PR adding this repo as a submodule to [zed-industries/extensions](https://github.com/zed-industries/extensions).

## License

MIT
