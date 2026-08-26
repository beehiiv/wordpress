const fs = require( 'fs' );
const path = require( 'path' );
const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/4-admin-assets/admin-styling.prd.md
 *
 * Brownfield-mapped PRD (no PLAN/EXECUTION trail) -- real code read directly:
 *   - includes/Admin/Assets.php   (enqueue logic: HANDLE_ADMIN='beehiiv-admin'
 *     entry 'admin' is enqueued on EVERY admin_enqueue_scripts call with no
 *     hook_suffix check -- i.e. truly global across all of wp-admin, not just
 *     the plugin's own page; HANDLE_ADMIN_SETTINGS='beehiiv-admin-settings'
 *     entry 'admin-settings' is only enqueued when hook_suffix equals
 *     'toplevel_page_beehiiv'. Both go through the same private
 *     enqueue_build_style() which requires both the *.asset.php AND *.css
 *     build files to exist before calling wp_enqueue_style(), else it
 *     silently returns.)
 *   - build/admin.asset.php, build/admin-settings.asset.php (version hashes
 *     used as the wp_enqueue_style() $ver argument for cache-busting)
 *   - includes/Admin/Views/settings-page.php (renders the same <h1> regardless
 *     of beehiiv connection state, so the settings page is safe to use as a
 *     fixture for AC-003 without needing a live OAuth connection)
 *
 * AC-003's edge case ("Metadata exists but CSS file is missing -> enqueuing
 * skipped silently, page loads normally") is exercised by temporarily
 * renaming build/admin-settings.css out of the way. That handle is scoped to
 * a single hook_suffix ('toplevel_page_beehiiv') via the code above, so the
 * blast radius of the rename is limited to the beehiiv settings page only --
 * every other wp-admin page (including ones sibling QA agents' specs may
 * exercise) is unaffected. The rename/restore is wrapped in try/finally so
 * the file is put back even if an assertion throws.
 */

const PLUGIN_ROOT = path.resolve( __dirname, '../../..' );
const ADMIN_SETTINGS_CSS = path.join( PLUGIN_ROOT, 'build/admin-settings.css' );
const ADMIN_SETTINGS_CSS_BAK = path.join( PLUGIN_ROOT, 'build/admin-settings.css.qa-bak' );
const ADMIN_ASSET_PHP = path.join( PLUGIN_ROOT, 'build/admin.asset.php' );

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

test.beforeAll( () => {
	ensurePluginActive();

	// Defensive: if a previous run crashed mid-test and left the backup file
	// in place without restoring the original, restore it now before this
	// run starts, so we always begin from a clean/complete build directory.
	if ( fs.existsSync( ADMIN_SETTINGS_CSS_BAK ) && ! fs.existsSync( ADMIN_SETTINGS_CSS ) ) {
		fs.renameSync( ADMIN_SETTINGS_CSS_BAK, ADMIN_SETTINGS_CSS );
	}
} );

test.afterAll( () => {
	// Final safety net matching the above.
	if ( fs.existsSync( ADMIN_SETTINGS_CSS_BAK ) && ! fs.existsSync( ADMIN_SETTINGS_CSS ) ) {
		fs.renameSync( ADMIN_SETTINGS_CSS_BAK, ADMIN_SETTINGS_CSS );
	}
} );

test.describe( 'Admin styling', () => {
	test( 'AC-001: global admin styles load on every wp-admin page, not just the plugin\'s own page', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );

		// A core WP admin screen with no relation to beehiiv at all.
		await page.goto( '/wp-admin/edit.php' );
		await expect( page.locator( 'link#beehiiv-admin-css' ) ).toHaveAttribute(
			'href',
			/build\/admin\.css/
		);

		// The WP dashboard.
		await page.goto( '/wp-admin/' );
		await expect( page.locator( 'link#beehiiv-admin-css' ) ).toHaveAttribute(
			'href',
			/build\/admin\.css/
		);

		// The plugin's own settings page.
		await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		await expect( page.locator( 'link#beehiiv-admin-css' ) ).toHaveAttribute(
			'href',
			/build\/admin\.css/
		);
	} );

	test( 'AC-002: the global stylesheet URL carries the build version as a cache-busting query arg', async ( {
		page,
	} ) => {
		const expectedVersion = readAssetVersion( ADMIN_ASSET_PHP );

		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );

		const href = await page.locator( 'link#beehiiv-admin-css' ).getAttribute( 'href' );
		expect( href ).toContain( `ver=${ expectedVersion }` );
	} );

	test( 'AC-003: a missing CSS build file is skipped silently -- no console errors/warnings and the page still renders', async ( {
		page,
	} ) => {
		expect( fs.existsSync( ADMIN_SETTINGS_CSS ) ).toBe( true );

		const consoleIssues = [];
		page.on( 'console', ( msg ) => {
			if ( msg.type() === 'error' || msg.type() === 'warning' ) {
				consoleIssues.push( `[${ msg.type() }] ${ msg.text() }` );
			}
		} );
		const pageErrors = [];
		page.on( 'pageerror', ( err ) => pageErrors.push( err.message ) );

		fs.renameSync( ADMIN_SETTINGS_CSS, ADMIN_SETTINGS_CSS_BAK );

		try {
			const response = await loginAsAdminAndGoToSettings( page );

			expect( response.status() ).toBe( 200 );
			// Page still renders normally.
			await expect( page.locator( 'h1' ) ).toHaveText( 'beehiiv Settings' );
			// The style tag for the missing bundle was never emitted -- proves
			// the PHP-side file_exists() guard actually skipped enqueuing
			// rather than emitting a link to a 404ing asset.
			await expect( page.locator( 'link#beehiiv-admin-settings-css' ) ).toHaveCount( 0 );

			expect( consoleIssues, `Console issues: ${ consoleIssues.join( '; ' ) }` ).toHaveLength( 0 );
			expect( pageErrors, `Page errors: ${ pageErrors.join( '; ' ) }` ).toHaveLength( 0 );
		} finally {
			fs.renameSync( ADMIN_SETTINGS_CSS_BAK, ADMIN_SETTINGS_CSS );
		}
	} );
} );

/**
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdminAndGoToSettings( page ) {
	await loginAsAdmin( page );
	return page.goto( '/wp-admin/admin.php?page=beehiiv' );
}
