# Beehiiv for WordPress

Your Beehiiv newsletters, launched straight from the WordPress editor.

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

**Local WordPress** — place the plugin in `wp-content/plugins/beehiiv`, run the setup commands above if needed, then activate **Beehiiv** under **Plugins** in wp-admin.

While developing JS/CSS, run `npm run start` in a second terminal.

## Development Commands

| Command               | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `npm run start`       | Webpack watcher — rebuilds `build/` on save |
| `npm run build`       | Production asset build                      |
| `npm run env:start`   | Start wp-env                                |
| `npm run env:stop`    | Stop wp-env                                 |
| `npm run env:destroy` | Tear down wp-env                            |
| `npm run lint`        | Lint JS, CSS, and PHP (or individually)     |

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
  editor/post-settings/                  # Beehiiv editor sidebar
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

A top-level **Beehiiv** wp-admin menu (not under Settings) is wired from `Plugin::bootstrap_admin_features()`:

| Class                     | Responsibility                                                   |
| ------------------------- | ---------------------------------------------------------------- |
| `Config`                  | Shared constants (slug, option name, REST namespace, view paths) |
| `Admin\SettingsPage`      | Registers Settings API fields; renders the screen                |
| `Admin\Menu`              | Sidebar menu → calls `SettingsPage::render`                      |
| `Admin\Options`           | `beehiiv_settings` option: defaults, `get()`, sanitize           |
| `Admin\Registrar`         | Registers publication ID and default email template fields       |
| `Connection\Manager`      | OAuth connection status and connect/disconnect URLs              |
| `OAuth\*`                 | Dynamic client registration, PKCE, token storage, refresh        |
| `REST\PostTemplatesController` | REST endpoint for publication email templates               |
| `Views/connection.php`    | Connection card and post-connect next steps                      |
| `Views/settings-page.php` | Form wrapper (`settings_fields`, `do_settings_sections`)         |

### Post settings sidebar

`src/js/editor/post-settings/index.js` registers a **Beehiiv** `PluginSidebar` (editor sidebar icon, not the Post → Settings document panel) on the default `post` post type via `@wordpress/plugins`. It is shown only to users who can publish posts. Server-side, `includes/Editor/PostSettings.php`:

-   Registers each meta key with `register_post_meta()` and `show_in_rest => true` so the editor can read/write it.
-   Enqueues `build/post-settings.js` (and CSS when present) only on `post` edit screens via `enqueue_block_editor_assets`.

Add new fields by keeping these in sync:

1. `includes/Editor/Meta.php` — PHP meta key constant
2. `src/js/shared/meta.js` — JS meta key constant
3. `META_KEYS` in `includes/Editor/PostSettings.php` — registration config
4. Controls in `src/js/editor/post-settings/index.js`

Connect your Beehiiv account from **Beehiiv → Settings** in wp-admin. OAuth credentials are stored encrypted in the `beehiiv_oauth` option.

For local development without a release build, set the registration token in `wp-config.php`:

```php
define( 'BEEHIIV_REGISTRATION_TOKEN', 'your_registration_token_here' );
```

Email template for API payloads uses the plugin default `post_template_id`; omit `post_template_id` from the request when unset (`Newsletter\PostSettingsBuilder`).

## Linting

```bash
npm run lint
```

Or individually: `lint:js`, `lint:css`, `lint:php`. Autofix variants: `lint:js:fix`, `lint:css:fix`, `lint:php:fix`, plus `npm run format` for Prettier.

On every pull request (and pushes to `main` / `master`), GitHub Actions runs the same checks via [`.github/workflows/lint.yml`](.github/workflows/lint.yml) on PHP **7.4** through **8.5**.
