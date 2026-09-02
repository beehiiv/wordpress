# beehiiv for WordPress

Your beehiiv newsletters, launched straight from the WordPress editor.

## Prerequisites

-   [Node.js](https://nodejs.org/) (version from `.nvmrc`, currently 20) and npm
-   [Composer](https://getcomposer.org/)
-   [Docker](https://www.docker.com/) — only if you use wp-env
-   **WordPress 6.5+** and **PHP 7.4+** (see `beehiiv.php`)

## Development environments

Use **wp-env** if you're running Docker — it spins up WordPress, creates the database, mounts this repo as the plugin, and activates it for you. No separate WordPress install required.

Or, if you prefer **Local**, **MAMP**, **Valet**, or similar, clone or symlink this repo into `wp-content/plugins/beehiiv`, run the [setup commands](#setup) below, and activate the plugin manually under **Plugins** in wp-admin.

## Setup

```bash
git clone <repository-url> beehiiv
cd beehiiv
nvm install && nvm use   # optional; use Node version from .nvmrc
npm install
composer install
npm run build
```

**wp-env** — start the environment (plugin is activated automatically):

```bash
npm run env:start
```

Site: [http://localhost:8888](http://localhost:8888) · Admin: [http://localhost:8888/wp-admin](http://localhost:8888/wp-admin) · Login: `admin` / `password`

**Local WordPress** — place the plugin in `wp-content/plugins/beehiiv`, run the setup commands above if needed, then activate **beehiiv** under **Plugins** in wp-admin.

While developing JS/CSS, run `npm run start` in a second terminal.

### Doppler + local beehiiv (wp-env)

OAuth and API bases default to production. For a local/staging beehiiv app, set these secrets in Doppler and start wp-env so they become `wp-config.php` constants:

| Doppler secret / constant    | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `BEEHIIV_REGISTRATION_TOKEN` | Bearer token for `/oauth/register`            |
| `BEEHIIV_OAUTH_BASE_URL`     | App origin (authorize / token / revoke)       |
| `BEEHIIV_API_BASE_URL`       | Public API origin including `/v2` path prefix |
| `BEEHIIV_SSLVERIFY`          | Set `false` when using a private local CA     |

```bash
cp docker-compose.extra-hosts.example.yml docker-compose.extra-hosts.yml

# Edit docker-compose.extra-hosts.yml so hostnames match your local app/API.

npm run env:start:doppler
```

That:

1. Mounts an ephemeral `.wp-env.override.json` from `.wp-env.override.tmpl` for `wp-env start`
2. If `docker-compose.extra-hosts.yml` exists, maps those hostnames to the Docker host (`host-gateway`) so WordPress inside the container can reach your machine

Re-run after changing Doppler secrets. If containers were recreated without the overlay, run `npm run env:hosts`.

Without Doppler, define the same constants in `wp-config.php`, or put them in a gitignored `.wp-env.override.json` (`config` map) and use `npm run env:start`.

If your local app uses HTTPS with a private CA, set `BEEHIIV_SSLVERIFY` to `false` (or install that CA in the WordPress container). PHP’s cURL does not trust host mkcert/Caddy CAs by default.

### Backward-compatibility testing (wp-env)

Point wp-env at a specific PHP / WordPress core version to check compatibility with older or newer combinations than your default local setup, and get an HTML dashboard for that combination:

```bash
npm run test:compat -- --php=8.1 --wp=6.8
```

That pins wp-env to PHP 8.1 / WP 6.8 (leaving it set for subsequent `npm run env:start` runs — clear with `npm run env:set-version -- --clear`), **destroys and recreates the wp-env environment** so the combination starts from a genuinely clean install, runs PHPUnit, and writes `tests/phpunit/test-results/php8.1-wp6.8/dashboard.html` — pass/fail counts, a per-class breakdown, and failure details. Run it again with different `--php`/`--wp` values to get a separate dashboard per combination; nothing gets overwritten. `--wp` accepts a WordPress.org release number (e.g. `6.8`), `latest` (wp-env's own default), or `nightly`.

⚠️ `test:compat` deletes your current wp-env database and content for this project (`wp-env destroy`) every time it runs. Only use it against a wp-env instance you're fine wiping — not one with dev content you want to keep.

To only change the pinned version without wiping anything, use `npm run env:set-version -- --php=8.1 --wp=6.8` directly — it writes to the gitignored `.wp-env.override.json`, so it never touches tracked config, and wp-env rebuilds the WordPress core files (not the database) the next time it starts. Because the database is left as-is, wp-admin will show the "database needs to be updated" screen after switching to a different WP version; run `npm run env:destroy` first if you want a clean database for manual browsing too. `npm run test:php:report` regenerates a dashboard from an existing JUnit report (e.g. after `composer test`) without re-running anything.

CI runs the full PHP × WP matrix on every PR (see `.github/workflows/test.yml`) and uploads one `phpunit-report-php{X}-wp{Y}` dashboard artifact per combination.

## Development Commands

| Command                     | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `npm run start`             | Webpack watcher — rebuilds `build/` on save          |
| `npm run build`             | Production asset build                               |
| `npm run env:start`         | Start wp-env (+ optional extra_hosts overlay)        |
| `npm run env:start:doppler` | Start with Doppler-mounted OAuth/API overrides       |
| `npm run env:hosts`         | Re-apply `docker-compose.extra-hosts.yml` if present |
| `npm run env:set-version`   | Pin wp-env's PHP/WP core version (`--php` / `--wp`)  |
| `npm run env:stop`          | Stop wp-env                                          |
| `npm run env:destroy`       | Tear down wp-env                                     |
| `npm run test:compat`       | Run PHPUnit for one PHP/WP combo + its own dashboard |
| `npm run test:php:report`   | Regenerate a PHPUnit dashboard from an existing run  |
| `npm run lint`              | Lint JS, CSS, and PHP (or individually)              |

## Project layout

```
beehiiv.php                              # Plugin bootstrap
includes/                                # PSR-4 PHP (Beehiiv\)
  Admin/                                 # Menu, settings, assets, views
  API/                                   # REST routes and controllers
  Blocks/Registry.php                    # Registers compiled blocks
  Connection/Manager.php                 # Connection helpers
  Editor/                                # Post editor sidebar + meta
  Frontend/Assets.php                    # Public site assets
src/js/                                  # JS / SCSS sources
  admin/                                 # wp-admin styles
  editor/post-settings/                  # beehiiv editor sidebar
  frontend/                              # Public site bundle
  blocks/<block-name>/                   # Block sources (auto-detected)
  shared/meta.js                         # Post meta keys (sync with Editor/Meta.php)
build/                                   # Compiled output (gitignored)
webpack.config.js                        # Extends @wordpress/scripts
```

### Custom blocks

Every directory under `src/js/blocks/` that contains a `block.json` is automatically picked up by `wp-scripts` and compiled into `build/blocks/<name>/`. The PHP side (`includes/Blocks/Registry.php`) walks `build/blocks/` and calls `register_block_type()` for each, so adding a new block is just:

1. Create `src/js/blocks/my-block/block.json` (point `editorScript`/`style`/`editorStyle` at `file:./index.js`, `file:./style-index.css`, `file:./index.css`).
2. Add `index.js`, `edit.js`, `save.js`, plus optional `editor.scss` / `style.scss`.
3. Run `npm run start` (or `npm run build`).

See `src/js/blocks/signup-form/` and `src/js/blocks/advertisement/` for block scaffolds.

### Dashboard settings

A top-level **beehiiv** wp-admin menu (not under Settings) is wired from `Plugin::bootstrap_admin_features()`:

| Class                          | Responsibility                                                   |
| ------------------------------ | ---------------------------------------------------------------- |
| `Config`                       | Shared constants (slug, option name, REST namespace, view paths) |
| `Admin\SettingsPage`           | Registers Settings API fields; renders the screen                |
| `Admin\Menu`                   | Sidebar menu → calls `SettingsPage::render`                      |
| `Admin\Options`                | `beehiiv_settings` option: defaults, `get()`, sanitize           |
| `Admin\Registrar`              | Registers publication ID and default post template fields        |
| `Connection\Manager`           | OAuth connection status and connect/disconnect URLs              |
| `OAuth\*`                      | Dynamic client registration, PKCE, token storage, refresh        |
| `REST\PostTemplatesController` | REST endpoint for publication post templates                     |
| `Views/connection.php`         | Connection card and post-connect next steps                      |
| `Views/settings-page.php`      | Form wrapper (`settings_fields`, `do_settings_sections`)         |

### Post settings sidebar

`src/js/editor/post-settings/index.js` registers a **beehiiv** `PluginSidebar` (editor sidebar icon, not the Post → Settings document panel) on the default `post` post type via `@wordpress/plugins`. It is shown only to users who can publish posts. Server-side, `includes/Editor/PostSettings.php`:

-   Registers each meta key with `register_post_meta()` and `show_in_rest => true` so the editor can read/write it.
-   Enqueues `build/post-settings.js` (and CSS when present) only on `post` edit screens via `enqueue_block_editor_assets`.

Add new fields by keeping these in sync:

1. `includes/Editor/Meta.php` — PHP meta key constant
2. `src/js/shared/meta.js` — JS meta key constant
3. `META_KEYS` in `includes/Editor/PostSettings.php` — registration config
4. Controls in `src/js/editor/post-settings/index.js`

Connect your beehiiv account from **beehiiv → Settings** in wp-admin. OAuth credentials are stored encrypted in the `beehiiv_oauth` option.

For local development without a release build, set overrides in `wp-config.php` (or via Doppler / `.wp-env.override.json` as above):

```php
define( 'BEEHIIV_REGISTRATION_TOKEN', 'your_registration_token_here' );
define( 'BEEHIIV_OAUTH_BASE_URL', 'https://app.example.test:8443' ); // optional
define( 'BEEHIIV_API_BASE_URL', 'https://api.example.test:8443/v2' ); // optional
define( 'BEEHIIV_SSLVERIFY', false ); // optional; local private CA only
```

Post template for API payloads uses the plugin default `post_template_id`; omit `post_template_id` from the request when unset (`Newsletter\PostSettingsBuilder`).

## Linting

```bash
npm run lint
```

Or individually: `lint:js`, `lint:css`, `lint:php`. Autofix variants: `lint:js:fix`, `lint:css:fix`, `lint:php:fix`, plus `npm run format` for Prettier.

On every pull request (and pushes to `main` / `master`), GitHub Actions runs the same checks via [`.github/workflows/lint.yml`](.github/workflows/lint.yml) on PHP **7.4** through **8.5**.

## Releasing (maintainers)

Only accounts with commit access to the WordPress.org `beehiiv` plugin can publish releases and asset updates.

Merging to `main` does **not** publish a new plugin version to WordPress.org. Deploy runs only when a **stable** GitHub Release is published (not on tag pushes or pre-releases), so beta tags can be used for testing without shipping to WordPress.org.

### New plugin version

1. Land changes on `main` via PR (CI must pass).
2. Bump the version in `beehiiv.php` and `readme.txt` (`Stable tag` + changelog).
3. Publish a GitHub Release for that version (e.g. tag `1.0.1`) — do **not** mark it as a pre-release.
4. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the plugin and deploys it to WordPress.org (`trunk`, `tags/<version>`, and `assets` from `.wordpress-org/`).
