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

| Doppler secret / constant    | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `BEEHIIV_REGISTRATION_TOKEN` | Bearer token for `/oauth/register`           |
| `BEEHIIV_OAUTH_BASE_URL`     | App origin (authorize / token / revoke)      |
| `BEEHIIV_API_BASE_URL`       | Public API origin including `/v2` path prefix |

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

If your local app uses HTTPS with a private CA, PHP inside the container must trust that CA or certificate verification will fail.

## Development Commands

| Command                     | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `npm run start`             | Webpack watcher — rebuilds `build/` on save                   |
| `npm run build`             | Production asset build                                        |
| `npm run env:start`         | Start wp-env (+ optional extra_hosts overlay)                 |
| `npm run env:start:doppler` | Start with Doppler-mounted OAuth/API overrides                |
| `npm run env:hosts`         | Re-apply `docker-compose.extra-hosts.yml` if present          |
| `npm run env:stop`          | Stop wp-env                                                   |
| `npm run env:destroy`       | Tear down wp-env                                              |
| `npm run lint`              | Lint JS, CSS, and PHP (or individually)                       |

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

| Class                     | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `Config`                  | Shared constants (slug, option name, REST namespace, view paths) |
| `Admin\SettingsPage`      | Registers Settings API fields; renders the screen                |
| `Admin\Menu`              | Sidebar menu → calls `SettingsPage::render`                      |
| `Admin\Options`           | `beehiiv_settings` option: defaults, `get()`, sanitize           |
| `Admin\Registrar`         | Registers publication ID and default post template fields       |
| `Connection\Manager`      | OAuth connection status and connect/disconnect URLs              |
| `OAuth\*`                 | Dynamic client registration, PKCE, token storage, refresh        |
| `REST\PostTemplatesController` | REST endpoint for publication post templates               |
| `Views/connection.php`    | Connection card and post-connect next steps                      |
| `Views/settings-page.php` | Form wrapper (`settings_fields`, `do_settings_sections`)         |

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
```

Post template for API payloads uses the plugin default `post_template_id`; omit `post_template_id` from the request when unset (`Newsletter\PostSettingsBuilder`).

## Linting

```bash
npm run lint
```

Or individually: `lint:js`, `lint:css`, `lint:php`. Autofix variants: `lint:js:fix`, `lint:css:fix`, `lint:php:fix`, plus `npm run format` for Prettier.

On every pull request (and pushes to `main` / `master`), GitHub Actions runs the same checks via [`.github/workflows/lint.yml`](.github/workflows/lint.yml) on PHP **7.4** through **8.5**.
