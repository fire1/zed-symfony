# Publishing to Zed Extensions Marketplace

1. Fork [zed-industries/extensions](https://github.com/zed-industries/extensions).

2. Add this repository as a git submodule:

```bash
git submodule add https://github.com/YOUR_ORG/zed-symfony extensions/symfony
```

3. Register the extension in `extensions/symfony/extension.toml` (already present in this repo).

4. Ensure the built LSP is included:

```bash
cd symfony-lsp && npm install && npm run build
git add symfony-lsp/dist
```

5. Build the WASM extension locally and verify with **Install Dev Extension** before submitting the PR.

6. PR checklist:
   - [ ] `extension.toml` has unique `id = "symfony"`
   - [ ] README documents required Zed settings
   - [ ] License file included (MIT)
   - [ ] No duplicate functionality with existing PHP extension (this complements Phpactor)

See [Developing Extensions](https://zed.dev/docs/extensions/developing-extensions) for full guidelines.
