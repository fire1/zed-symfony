use std::{env, fs};

use zed_extension_api::{self as zed, LanguageServerId, Result};

/// Bundled LSP installed into Zed's extension work directory.
const SERVER_BUNDLE: &str = "symfony-lsp-server.js";

/// Path after `npm install symfony-lsp-zed` (when published to npm).
const NPM_SERVER_PATH: &str = "node_modules/symfony-lsp-zed/dist/server.bundle.js";
const NPM_PACKAGE: &str = "symfony-lsp-zed";
const NPM_VERSION: &str = "0.1.0";

/// Fallback download when the npm package is not published yet.
const GITHUB_BUNDLE_URL: &str = "https://raw.githubusercontent.com/fire1/zed-symfony/v0.1.0/symfony-lsp/dist/server.bundle.js";

struct SymfonyExtension {
    did_find_server: bool,
}

impl SymfonyExtension {
    fn server_exists(path: &str) -> bool {
        fs::metadata(path).is_ok_and(|stat| stat.is_file())
    }

    fn server_script_path(
        &mut self,
        language_server_id: &LanguageServerId,
    ) -> Result<String> {
        if Self::server_exists(SERVER_BUNDLE) {
            return Ok(SERVER_BUNDLE.to_string());
        }

        if self.did_find_server && Self::server_exists(NPM_SERVER_PATH) {
            return Ok(NPM_SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        // Try npm registry (works once symfony-lsp-zed is published).
        let npm_result = zed::npm_install_package(NPM_PACKAGE, NPM_VERSION);
        if npm_result.is_ok() && Self::server_exists(NPM_SERVER_PATH) {
            self.did_find_server = true;
            return Ok(NPM_SERVER_PATH.to_string());
        }

        // Try downloading the bundled server from GitHub releases/raw.
        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        if zed::download_file(
            GITHUB_BUNDLE_URL,
            SERVER_BUNDLE,
            zed::DownloadedFileType::Uncompressed,
        )
        .is_ok()
            && Self::server_exists(SERVER_BUNDLE)
        {
            self.did_find_server = true;
            return Ok(SERVER_BUNDLE.to_string());
        }

        Err(format!(
            "Symfony LSP not found in Zed extension work directory.\n\
             Zed runs extensions from ~/.local/share/zed/extensions/work/symfony/ \
             (not your source tree).\n\n\
             Fix: from the extension root run:\n\
               npm run setup-zed\n\
             Then restart Zed.\n\n\
             Or manually:\n\
               npm run build\n\
               cp symfony-lsp/dist/server.bundle.js \
               ~/.local/share/zed/extensions/work/symfony/symfony-lsp-server.js"
        ))
    }
}

impl zed::Extension for SymfonyExtension {
    fn new() -> Self {
        Self {
            did_find_server: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        if let Some(path) = worktree.which("symfony-lsp") {
            return Ok(zed::Command {
                command: path,
                args: vec!["--stdio".to_string()],
                env: Default::default(),
            });
        }

        let server_path = self.server_script_path(language_server_id)?;
        let abs_path = env::current_dir()
            .map_err(|e| format!("failed to get current directory: {e}"))?
            .join(&server_path);

        if !abs_path.is_file() {
            return Err(format!("Symfony LSP not found at '{}'", abs_path.display()));
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                abs_path.to_string_lossy().into(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SymfonyExtension);
