const fs = require( 'fs' );
const path = require( 'path' );
const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/4-admin-assets/settings-page-assets.prd.md
 *
 * Brownfield-mapped PRD (no PLAN/EXECUTION trail -- provenance:
 * brownfield-mapped, so `execute-prd` never ran for this feature). File
 * discovery was done by direct code search, not a PLAN/EXECUTION file list:
 *   - includes/Admin/Assets.php (enqueue logic -- `enqueue_admin_scripts()`
 *     unconditionally enqueues the global 'admin' style handle, then returns
 *     early unless `$hook_suffix === 'toplevel_page_' . Config::PLUGIN_SLUG`
 *     ('toplevel_page_beehiiv', confirmed by reading includes/Admin/Menu.php's
 *     add_menu_page() call and independently by curling the logged-in page
 *     source). Only when that hook matches does it enqueue BOTH
 *     HANDLE_ADMIN_SETTINGS ('beehiiv-admin-settings', build/admin-settings.css)
 *     via wp_enqueue_style() and HANDLE_ADMIN_SETTINGS_SCRIPT
 *     ('beehiiv-admin-settings', build/admin-settings.js) via
 *     wp_enqueue_script() + wp_set_script_translations($handle, 'beehiiv').
 *     The style and script each independently guard on file_exists() for
 *     their own *.asset.php + built file before enqueueing -- there is no
 *     joint "both must exist" check despite the PRD's BR-002 phrasing; each
 *     asset degrades gracefully on its own.
 *   - build/admin-settings.asset.php (dependencies: wp-api-fetch, wp-i18n;
 *     version hash used as the wp_enqueue_style/script() cache-busting $ver)
 *   - src/js/admin/settings/index.js (the actual JS entry -- imports
 *     `@wordpress/api-fetch` and `@wordpress/i18n`'s `__`; looks up
 *     #beehiiv_publication_id / #beehiiv_post_template_id / the refresh
 *     button by ID and no-ops via `if (publicationSelect && templateSelect)`
 *     guards when they're absent, rather than throwing)
 *   - includes/Admin/Views/settings-page.php (the interactive form --
 *     do_settings_sections(), which is where those IDs would render -- is
 *     gated behind `$beehiiv_can_write_posts`, itself gated behind
 *     `Manager::is_connected()` i.e. TokenStore::has_credentials(). This
 *     wp-env tests environment has no `beehiiv_oauth` option at all
 *     (confirmed via `wp option get beehiiv_oauth` erroring "does it
 *     exist?"), so is_connected() is false, Workspace::can_write_posts()'s
 *     live HTTP call is never even reached, and the form never renders here.)
 *   - languages/ (contains only beehiiv.pot -- no compiled .mo/.json
 *     translation catalog ships in this repo or this environment)
 *
 * AC-001/AC-004's file-presence edge cases are exercised by temporarily
 * renaming build/admin-settings.css and build/admin-settings.js out of the
 * way, same technique the admin-styling sibling spec used for the global
 * bundle. Both handles are scoped to hook_suffix 'toplevel_page_beehiiv'
 * only, so the blast radius is limited to the beehiiv settings page --
 * every other wp-admin page (including ones sibling QA agents' specs may
 * exercise) is unaffected. Renames are wrapped in try/finally so files are
 * restored even if an assertion throws, plus a defensive restore in
 * beforeAll/afterAll in case a previous run crashed mid-test.
 *
 * AC-003 (translatable strings) is documented as browser-untestable below
 * rather than given a hollow always-passing test -- see the reasoning next
 * to its entry in the coverage report.
 */

const PLUGIN_ROOT = path.resolve( __dirname, '../../..' );
const SETTINGS_CSS = path.join( PLUGIN_ROOT, 'build/admin-settings.css' );
const SETTINGS_CSS_BAK = path.join( PLUGIN_ROOT, 'build/admin-settings.css.qa-bak' );
const SETTINGS_JS = path.join( PLUGIN_ROOT, 'build/admin-settings.js' );
const SETTINGS_JS_BAK = path.join( PLUGIN_ROOT, 'build/admin-settings.js.qa-bak' );
const SETTINGS_ASSET_PHP = path.join( PLUGIN_ROOT, 'build/admin-settings.asset.php' );

/**
 * Reads the `version` value out of a webpack-generated `*.asset.php` file
 * (a literal `<?php return array('dependencies' => array(...), 'version' =>
 * '<hash>');`) without needing a PHP runtime -- the format is static/generated,
 * never hand-authored.
 *
 * @param {string} assetPhpPath
 */
function readAssetVersion( assetPhpPath ) {
	const contents = fs.readFileSync( assetPhpPath, 'utf8' );
	const match = contents.match( /'version'\s*=>\s*'([^']+)'/ );
	if ( ! match ) {
		throw new Error( `Could not find a version string in ${ assetPhpPath }` );
	}
	return match[ 1 ];
}

/** Restore both build files from their .qa-bak counterparts if a prior crashed run left them renamed. */
function restoreIfBackedUp() {
	if ( fs.existsSync( SETTINGS_CSS_BAK ) && ! fs.existsSync( SETTINGS_CSS ) ) {
		fs.renameSync( SETTINGS_CSS_BAK, SETTINGS_CSS );
	}
	if ( fs.existsSync( SETTINGS_JS_BAK ) && ! fs.existsSync( SETTINGS_JS ) ) {
		fs.renameSync( SETTINGS_JS_BAK, SETTINGS_JS );
	}
}

test.beforeAll( () => {
	ensurePluginActive();
	restoreIfBackedUp();
} );

test.afterAll( () => {
	restoreIfBackedUp();
} );

test.describe( 'Settings Page Assets', () => {
	test( 'AC-001: settings page CSS and JS load only when viewing the plugin\'s main settings page', async ( {
		page,
	} ) => {
		const expectedVersion = readAssetVersion( SETTINGS_ASSET_PHP );

		await loginAsAdmin( page );

		// The plugin's own settings page -- both assets present, cache-busted
		// with the real build hash.
		await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		const cssHref = await page
			.locator( 'link#beehiiv-admin-settings-css' )
			.getAttribute( 'href' );
		expect( cssHref ).toContain( 'build/admin-settings.css' );
		expect( cssHref ).toContain( `ver=${ expectedVersion }` );

		const jsSrc = await page
			.locator( 'script#beehiiv-admin-settings-js' )
			.getAttribute( 'src' );
		expect( jsSrc ).toContain( 'build/admin-settings.js' );
		expect( jsSrc ).toContain( `ver=${ expectedVersion }` );

		// A core wp-admin screen with no relation to beehiiv at all.
		await page.goto( '/wp-admin/edit.php' );
		await expect( page.locator( 'link#beehiiv-admin-settings-css' ) ).toHaveCount( 0 );
		await expect( page.locator( 'script#beehiiv-admin-settings-js' ) ).toHaveCount( 0 );

		// The WP dashboard.
		await page.goto( '/wp-admin/' );
		await expect( page.locator( 'link#beehiiv-admin-settings-css' ) ).toHaveCount( 0 );
		await expect( page.locator( 'script#beehiiv-admin-settings-js' ) ).toHaveCount( 0 );
	} );

	test( 'AC-002: the settings script loads with its declared dependencies resolved and executes without errors', async ( {
		page,
	} ) => {
		const consoleIssues = [];
		page.on( 'console', ( msg ) => {
			if ( msg.type() === 'error' || msg.type() === 'warning' ) {
				consoleIssues.push( `[${ msg.type() }] ${ msg.text() }` );
			}
		} );
		const pageErrors = [];
		page.on( 'pageerror', ( err ) => pageErrors.push( err.message ) );

		await loginAsAdmin( page );
		await page.goto( '/wp-admin/admin.php?page=beehiiv' );

		// build/admin-settings.asset.php declares dependencies: wp-api-fetch,
		// wp-i18n -- WordPress's dependency resolver must therefore also
		// print those handles' own script tags on this page for
		// admin-settings.js's `import apiFetch from '@wordpress/api-fetch'`
		// and `import { __ } from '@wordpress/i18n'` to resolve at runtime.
		await expect( page.locator( 'script#wp-api-fetch-js' ) ).toHaveCount( 1 );
		await expect( page.locator( 'script#wp-i18n-js' ) ).toHaveCount( 1 );
		await expect( page.locator( 'script#beehiiv-admin-settings-js' ) ).toHaveCount( 1 );

		// The interactive publication/template dropdowns this script wires up
		// are gated behind a live beehiiv connection (Workspace::can_write_posts()
		// -- see file-header note) and are not present in this environment;
		// the script's own top-level guards (`if (publicationSelect &&
		// templateSelect)`) must no-op cleanly rather than throwing when those
		// elements are absent -- proving dependency resolution actually
		// succeeded end to end (a missing/misordered dependency would surface
		// as a ReferenceError/TypeError here, not silence).
		await page.waitForLoadState( 'networkidle' );

		expect( consoleIssues, `Console issues: ${ consoleIssues.join( '; ' ) }` ).toHaveLength( 0 );
		expect( pageErrors, `Page errors: ${ pageErrors.join( '; ' ) }` ).toHaveLength( 0 );
	} );

	test( 'AC-004: missing settings CSS and JS build files are skipped silently -- no console errors and the page still renders', async ( {
		page,
	} ) => {
		expect( fs.existsSync( SETTINGS_CSS ) ).toBe( true );
		expect( fs.existsSync( SETTINGS_JS ) ).toBe( true );

		const consoleIssues = [];
		page.on( 'console', ( msg ) => {
			if ( msg.type() === 'error' || msg.type() === 'warning' ) {
				consoleIssues.push( `[${ msg.type() }] ${ msg.text() }` );
			}
		} );
		const pageErrors = [];
		page.on( 'pageerror', ( err ) => pageErrors.push( err.message ) );

		fs.renameSync( SETTINGS_CSS, SETTINGS_CSS_BAK );
		fs.renameSync( SETTINGS_JS, SETTINGS_JS_BAK );

		try {
			await loginAsAdmin( page );
			const response = await page.goto( '/wp-admin/admin.php?page=beehiiv' );

			expect( response.status() ).toBe( 200 );
			// Page still renders normally -- the h1 is unconditional in
			// settings-page.php regardless of connection state.
			await expect( page.locator( 'h1' ) ).toHaveText( 'beehiiv Settings' );

			// The tags for the missing bundles were never emitted -- proves
			// the PHP-side file_exists() guards in enqueue_build_style() /
			// enqueue_build_script() actually skipped enqueueing rather than
			// emitting links/scripts to 404ing assets.
			await expect( page.locator( 'link#beehiiv-admin-settings-css' ) ).toHaveCount( 0 );
			await expect( page.locator( 'script#beehiiv-admin-settings-js' ) ).toHaveCount( 0 );

			expect( consoleIssues, `Console issues: ${ consoleIssues.join( '; ' ) }` ).toHaveLength( 0 );
			expect( pageErrors, `Page errors: ${ pageErrors.join( '; ' ) }` ).toHaveLength( 0 );
		} finally {
			fs.renameSync( SETTINGS_CSS_BAK, SETTINGS_CSS );
			fs.renameSync( SETTINGS_JS_BAK, SETTINGS_JS );
		}
	} );

	// AC-003: User-facing text in settings page JavaScript is translatable.
	//
	// Deliberately not given a Playwright test() -- see
	// includes/Admin/Assets.php's enqueue_build_script(), which calls
	// wp_set_script_translations('beehiiv-admin-settings', 'beehiiv'). Reading
	// wp-includes/l10n.php's print_translations() / _load_script_textdomain_
	// from_src() in the actual WP core running this environment confirms that
	// call only produces an *observable* difference (a
	// `wp.i18n.setLocaleData(...)` inline <script id="beehiiv-admin-settings-
	// js-translations"> tag) when WordPress can resolve a real compiled
	// translation catalog for the current locale -- a file named
	// `beehiiv-{locale}-{md5('build/admin-settings.js')}.json` inside WP
	// core's own wp-content/languages/plugins/ directory (not this plugin's
	// mounted directory; core's languages dir lives inside the wp-env docker
	// volume). This repo ships only languages/beehiiv.pot (a template, not a
	// compiled catalog) and this environment has no such catalog installed
	// for any locale, confirmed via `find . -iname "beehiiv*.json"` /
	// `-iname "beehiiv*.mo"` returning nothing. Consequently the rendered
	// HTML is bit-identical whether wp_set_script_translations() was called
	// or not -- there is no browser-observable signal in this environment
	// that would let a Playwright assertion distinguish "correctly wired for
	// translation" from "not wired at all". Verifying it properly would
	// require writing a precisely-hashed fixture file directly into WP
	// core's language directory inside the wp-env container's docker volume
	// (outside the plugin's mounted path and outside anything `wp-cli` /
	// Playwright can drive) -- backend-only wiring this skill's contract
	// names as a legitimate untestable reason ("depends on state Playwright
	// can't drive"), not something to fake with a hollow always-passing test.
} );
