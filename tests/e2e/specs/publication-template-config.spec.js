const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/1-settings-page/publication-template-config.prd.md
 *
 * RE-RUN NOTE: a prior run of this spec found all 13 ACs browser-untestable.
 * Every AC in this PRD describes behavior of the publication/template
 * settings form (two `<select>`s and a "Refresh templates" button), which
 * `includes/Admin/Views/settings-page.php` renders only inside
 * `<?php if ( $beehiiv_can_write_posts ) : ?>`. `Workspace::can_write_posts()`
 * made a live, uncacheable call to the real beehiiv `/workspaces/permissions`
 * API with no filter/mock seam, and this wp-env tests build has no working
 * OAuth client, so that call always failed and the form never rendered.
 *
 * Since then, `tests/e2e/plugins/beehiiv-options.php` (test-only mu-plugin,
 * wp-env *tests* environment only -- see `.wp-env.json`'s
 * `env.tests.mappings`) added:
 * - `beehiiv_e2e_seed_connection()` -- real `TokenStore::save_tokens()`, so
 *   `Manager::is_connected()` is genuinely true.
 * - `beehiiv_e2e_mock_permissions()` -- short-circuits just the one live
 *   `GET /workspaces/permissions` call, so `Workspace::can_write_posts()` is
 *   genuinely true too.
 * - `beehiiv_e2e_seed_publications()` / `beehiiv_e2e_seed_post_templates()`
 *   -- seed the real transient caches `Beehiiv\API\Cache` reads
 *   (`Cache::get_publications()` / `Cache::get_post_templates()`), so
 *   `Publications::get_publications()` / `PostTemplates::get_post_templates()`
 *   return fixture data on a cache hit without ever calling the live
 *   beehiiv `/publications` or `/publications/{id}/post_templates` APIs.
 *
 * Together these make the gated form render for real, for a real
 * logged-in-via-`loginAsAdmin()` Playwright session, exercising the actual
 * PHP render methods (`Registrar::render_publication_id_field()` /
 * `render_post_template_id_field()`) and the actual client JS
 * (`src/js/admin/settings/index.js`, built to `build/admin-settings.js`) --
 * not anything faked at the DOM level.
 *
 * One code path has no cache/mock seam: the "Refresh templates" button
 * always sends `refresh=1`, which `PostTemplatesController::get_items()`
 * turns straight into `Cache::delete_post_templates()` before re-fetching --
 * bypassing any seeded cache by design. In this environment that re-fetch
 * genuinely reaches out to the live beehiiv API and fails (no working OAuth
 * token), which is itself the exact "beehiiv API temporarily unavailable"
 * edge case this PRD's Q-001 already resolves ("clear dropdown, allow silent
 * retry") -- so AC-008/AC-009 assert the parts of that flow which do not
 * depend on the live call succeeding (cache genuinely cleared, no form
 * submission, REST round trip completes, confirmation notice still shown
 * since the REST endpoint always replies 200).
 *
 * Code paths under test:
 * - `includes/Admin/Views/settings-page.php`, `includes/Admin/Registrar.php`
 *   -- form gating and both `<select>` fields' server-rendered markup.
 * - `src/js/admin/settings/index.js` -- publication-change and
 *   refresh-button handlers, template dropdown population, notices.
 * - `includes/REST/PostTemplatesController.php`,
 *   `includes/API/Resources/PostTemplates.php`, `includes/API/Cache.php` --
 *   the REST route the client JS calls, and its cache-hit/refresh contract.
 * - `includes/Admin/Options.php` `Options::sanitize()` -- save path
 *   (composes with the sibling `settings-validation-cache` PRD's own AC
 *   coverage of the same method; this file drives it through a real
 *   "Save settings" click rather than a raw `options.php` POST, since
 *   AC-012's wording is specifically about that click and every value this
 *   file saves is a normal seeded option, not a payload a `<select>`
 *   can't carry).
 */

const OAUTH_OPTION = 'beehiiv_oauth';
const SETTINGS_OPTION = 'beehiiv_settings';
const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';

const PUB_SELECT = '#beehiiv_publication_id';
const TPL_SELECT = '#beehiiv_post_template_id';
const REFRESH_BTN = '#beehiiv_refresh_post_templates';

/** Seeds a connected + write-authorized state via the test-only mu-plugin seam. */
function seedConnectedAndAuthorized() {
	wpCli(
		'eval \'beehiiv_e2e_seed_connection(); beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );\''
	);
}

/** Base64-JSON-encodes a JS value for safe passage through a single-quoted `wp eval` argument. */
function toPhpJsonArg( data ) {
	return Buffer.from( JSON.stringify( data ) ).toString( 'base64' );
}

/** Seeds the publications list cache directly (skips the real GET /publications call). */
function seedPublications( publications ) {
	wpCli(
		`eval 'beehiiv_e2e_seed_publications( json_decode( base64_decode( "${ toPhpJsonArg( publications ) }" ), true ) );'`
	);
}

/** Seeds the post-templates cache for one publication (skips the real per-publication call). */
function seedTemplates( publicationId, templates ) {
	wpCli(
		`eval 'beehiiv_e2e_seed_post_templates( "${ publicationId }", json_decode( base64_decode( "${ toPhpJsonArg( templates ) }" ), true ) );'`
	);
}

/**
 * Answers beehiiv's post-templates list call for a publication with a fixed
 * list, so a manual refresh never waits on the live API (a fake token there
 * means a failed request plus a failed token refresh, up to 30s each).
 */
function mockLiveTemplates( publicationId, templates ) {
	wpCli(
		`eval 'beehiiv_e2e_mock_http( "/publications/${ publicationId }/post_templates", [ "body" => [ "data" => json_decode( base64_decode( "${ toPhpJsonArg(
			templates
		) }" ), true ) ] ] );'`
	);
}

/** Writes the beehiiv_settings option directly, bypassing the form -- for arranging initial page-load state. */
function setSettingsOption( publicationId, postTemplateId ) {
	const json = JSON.stringify( {
		publication_id: publicationId,
		post_template_id: postTemplateId,
	} );
	wpCli( `option update ${ SETTINGS_OPTION } '${ json }' --format=json` );
}

/** Reads the current stored beehiiv_settings option as a parsed object (or null). */
function readSettingsOption() {
	const raw = wpCliSafe( `option get ${ SETTINGS_OPTION } --format=json` );
	return raw ? JSON.parse( raw ) : null;
}

/** Reads Cache::get_post_templates() for a publication via the real PHP read path. */
function readCachedTemplates( publicationId ) {
	const raw = wpCliSafe(
		`eval 'echo wp_json_encode( \\Beehiiv\\API\\Cache::get_post_templates( "${ publicationId }" ) );'`
	);
	return raw ? JSON.parse( raw ) : null;
}

test.beforeAll( () => {
	ensurePluginActive();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production -- see
	// playwright.config.js), so there is no real state worth preserving
	// here; the only contract other agents' specs need from this file is
	// "leave beehiiv_oauth/beehiiv_settings absent", not "restore whatever
	// was here before" (which just perpetuates any earlier run's leftovers).
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
} );

test.afterAll( () => {
	// Every step here is a safe delete (never throws, even if already
	// absent), so one failing step can never skip another -- unlike
	// restoring a captured "original" value, which can.
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	wpCliSafe( `option delete ${ OAUTH_OPTION }` );
	wpCliSafe( `option delete ${ SETTINGS_OPTION }` );
} );

test.describe( 'Publication and Template Configuration', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
	} );

	test.afterEach( () => {
		// Clears the permissions mock, OAuth connection, and every beehiiv
		// transient cache -- so nothing this file seeds leaks into whichever
		// agent's spec runs next against this shared tests environment.
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-001: publication dropdown displays all publications available in the connected beehiiv account', async ( { page } ) => {
		seedConnectedAndAuthorized();
		seedPublications( [
			{ id: 'qa-e2e-pub-ac001-a', name: 'QA Publication Alpha' },
			{ id: 'qa-e2e-pub-ac001-b', name: 'QA Publication Beta' },
		] );

		await page.goto( SETTINGS_PATH );

		const select = page.locator( PUB_SELECT );
		await expect( select ).toHaveCount( 1 );

		const optionTexts = ( await select.locator( 'option' ).allTextContents() ).map( ( t ) =>
			t.trim()
		);
		expect( optionTexts ).toContain( 'QA Publication Alpha' );
		expect( optionTexts ).toContain( 'QA Publication Beta' );
	} );

	test( 'AC-002: publication selection is required and a placeholder option guides the user to select one', async ( { page } ) => {
		seedConnectedAndAuthorized();
		seedPublications( [ { id: 'qa-e2e-pub-ac002', name: 'QA Publication AC002' } ] );
		setSettingsOption( '', '' );

		await page.goto( SETTINGS_PATH );

		const select = page.locator( PUB_SELECT );
		await expect( select ).toHaveAttribute( 'required', '' );

		const firstOption = select.locator( 'option' ).first();
		await expect( firstOption ).toHaveAttribute( 'value', '' );
		await expect( firstOption ).toHaveText( /Select a publication/ );
	} );

	test( 'AC-003: post template dropdown is disabled and empty until a publication is selected', async ( { page } ) => {
		// "Disabled" half of this AC is a known failure -- see the assertion
		// below for the concrete reason (real PRD/implementation mismatch,
		// not flakiness). Remove test.fail() once Registrar.php or the PRD
		// is reconciled.
		test.fail();

		seedConnectedAndAuthorized();
		setSettingsOption( '', '' );

		await page.goto( SETTINGS_PATH );

		const select = page.locator( TPL_SELECT );
		await expect( select ).toHaveCount( 1 );

		// "Empty" half of the AC: only the placeholder option renders when no
		// publication is selected (Registrar::render_post_template_id_field()
		// only queries PostTemplates::get_post_templates() when publication_id
		// is non-empty).
		await expect( select.locator( 'option' ) ).toHaveCount( 1 );

		// "Disabled" half of the AC: reading
		// Registrar::render_post_template_id_field() shows the <select> is
		// never server-rendered with a `disabled` attribute at all -- unlike
		// the refresh button a few lines below it, which does use
		// `disabled( '' === $publication_id )`. src/js/admin/settings/index.js
		// only ever sets `templateSelect.disabled = true` transiently during
		// an in-flight fetch (inside loadTemplates()), never on initial page
		// load. This assertion follows the AC's literal wording and is
		// expected to FAIL against the real DOM -- that failure is the
		// evidence for a genuine PRD/implementation mismatch, not a flaky
		// test.
		await expect( select ).toBeDisabled();
	} );

	test( 'AC-004: post template dropdown populates automatically when publication selection changes', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac004';
		seedPublications( [ { id: pubId, name: 'QA Publication AC004' } ] );
		seedTemplates( pubId, [ { id: 'qa-e2e-tpl-ac004', name: 'QA Template AC004' } ] );
		setSettingsOption( '', '' );

		await page.goto( SETTINGS_PATH );

		const pubSelect = page.locator( PUB_SELECT );
		const tplSelect = page.locator( TPL_SELECT );

		await expect( tplSelect.locator( 'option' ) ).toHaveCount( 1 );

		const [ response ] = await Promise.all( [
			page.waitForResponse(
				( resp ) =>
					resp.url().includes( '/beehiiv/v1/post-templates' ) &&
					resp.url().includes( pubId )
			),
			pubSelect.selectOption( pubId ),
		] );
		expect( response.status() ).toBe( 200 );

		await expect(
			tplSelect.locator( 'option', { hasText: 'QA Template AC004' } )
		).toHaveCount( 1 );
	} );

	test( 'AC-005: post template selection is optional; a "No default template" option is always available', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac005';
		seedPublications( [ { id: pubId, name: 'QA Publication AC005' } ] );
		seedTemplates( pubId, [ { id: 'qa-e2e-tpl-ac005', name: 'QA Template AC005' } ] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );

		const tplSelect = page.locator( TPL_SELECT );
		expect( await tplSelect.getAttribute( 'required' ) ).toBeNull();

		const firstOption = tplSelect.locator( 'option' ).first();
		await expect( firstOption ).toHaveAttribute( 'value', '' );
		await expect( firstOption ).toHaveText( /No default template/ );
	} );

	test( 'AC-006: "Refresh templates" button is visible and enabled when a publication is selected', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac006';
		seedPublications( [ { id: pubId, name: 'QA Publication AC006' } ] );
		seedTemplates( pubId, [ { id: 'qa-e2e-tpl-ac006', name: 'QA Template AC006' } ] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );

		const button = page.locator( REFRESH_BTN );
		await expect( button ).toBeVisible();
		await expect( button ).toBeEnabled();
	} );

	test( 'AC-007: "Refresh templates" button is disabled when no publication is selected', async ( { page } ) => {
		seedConnectedAndAuthorized();
		setSettingsOption( '', '' );

		await page.goto( SETTINGS_PATH );

		const button = page.locator( REFRESH_BTN );
		await expect( button ).toBeVisible();
		await expect( button ).toBeDisabled();
	} );

	test( 'AC-008: clicking "Refresh templates" fetches the latest template list from beehiiv without submitting the form', async ( { page } ) => {
		// Refresh always bypasses the cache (Cache::delete_post_templates()
		// runs before re-fetching), so it reaches beehiiv's list endpoint.
		// That call is mocked with a *different* list than the seeded cache,
		// so the test never depends on live network latency.
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac008';
		seedPublications( [ { id: pubId, name: 'QA Publication AC008' } ] );
		seedTemplates( pubId, [ { id: 'qa-e2e-tpl-ac008-old', name: 'QA Template AC008 Old' } ] );
		mockLiveTemplates( pubId, [ { id: 'qa-e2e-tpl-ac008-new', name: 'QA Template AC008 New' } ] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );
		expect( readCachedTemplates( pubId ) ).not.toBeNull();

		const urlBefore = page.url();

		const [ response ] = await Promise.all( [
			page.waitForResponse(
				( resp ) =>
					resp.url().includes( '/beehiiv/v1/post-templates' ) &&
					resp.url().includes( 'refresh=1' ),
				{ timeout: 30000 }
			),
			page.locator( REFRESH_BTN ).click(),
		] );
		expect( response.status() ).toBe( 200 );

		// No form submission occurred -- still the same admin.php?page=beehiiv
		// URL, no options.php redirect.
		expect( page.url() ).toBe( urlBefore );

		// PostTemplatesController::get_items() calls
		// Cache::delete_post_templates() before re-fetching when `refresh=1`
		// is sent. The cache now holds beehiiv's (mocked) new list instead of
		// the old seeded one -- proving the refresh really executed a
		// bypass-cache round trip rather than serving the cached list.
		const cached = readCachedTemplates( pubId );
		expect( cached.map( ( item ) => item.id ) ).toEqual( [ 'qa-e2e-tpl-ac008-new' ] );
		await expect( page.locator( '#beehiiv_post_template_id' ) ).toContainText( 'QA Template AC008 New' );
	} );

	test( 'AC-009: a "Templates updated" notice appears briefly after manual refresh', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac009';
		seedPublications( [ { id: pubId, name: 'QA Publication AC009' } ] );
		seedTemplates( pubId, [ { id: 'qa-e2e-tpl-ac009', name: 'QA Template AC009' } ] );
		mockLiveTemplates( pubId, [ { id: 'qa-e2e-tpl-ac009', name: 'QA Template AC009' } ] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );

		// showRefreshNotice() runs on the success branch of loadTemplates()'s
		// try block, reached once the REST call resolves; beehiiv's list call
		// is mocked so the round trip is fast and deterministic.
		await Promise.all( [
			page.waitForResponse(
				( resp ) =>
					resp.url().includes( '/beehiiv/v1/post-templates' ) &&
					resp.url().includes( 'refresh=1' ),
				{ timeout: 30000 }
			),
			page.locator( REFRESH_BTN ).click(),
		] );

		const notice = page.locator( '.beehiiv-refresh-notice' );
		await expect( notice ).toBeVisible();
		await expect( notice ).toHaveText( /Templates updated/ );
	} );

	test( 'AC-010: "No templates available" notice appears and refresh button is shown when the selected publication has no templates', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac010';
		seedPublications( [ { id: pubId, name: 'QA Publication AC010' } ] );
		// Cached empty list -- a genuine cache hit (Cache::get_post_templates()
		// returns [] rather than null), so no live call is made and the "no
		// templates" branch is reached deterministically.
		seedTemplates( pubId, [] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );

		const notice = page.locator( '.beehiiv-no-templates-notice' );
		await expect( notice ).toBeVisible();
		await expect( notice ).toHaveText( /no post templates/i );

		await expect( page.locator( REFRESH_BTN ) ).toBeVisible();
	} );

	test( 'AC-011: previously selected publication and template values persist across a reload', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac011';
		const tplId = 'qa-e2e-tpl-ac011';
		seedPublications( [ { id: pubId, name: 'QA Publication AC011' } ] );
		seedTemplates( pubId, [ { id: tplId, name: 'QA Template AC011' } ] );
		setSettingsOption( pubId, tplId );

		await page.goto( SETTINGS_PATH );
		await expect( page.locator( PUB_SELECT ) ).toHaveValue( pubId );
		await expect( page.locator( TPL_SELECT ) ).toHaveValue( tplId );

		// A fresh navigation -- same as the admin returning in a later session.
		await page.reload();
		await expect( page.locator( PUB_SELECT ) ).toHaveValue( pubId );
		await expect( page.locator( TPL_SELECT ) ).toHaveValue( tplId );
	} );

	test( 'AC-012: form saves selections when the user clicks "Save settings"', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac012';
		const tplId = 'qa-e2e-tpl-ac012';
		seedPublications( [ { id: pubId, name: 'QA Publication AC012' } ] );
		seedTemplates( pubId, [ { id: tplId, name: 'QA Template AC012' } ] );
		setSettingsOption( '', '' );

		await page.goto( SETTINGS_PATH );

		const [ templatesResponse ] = await Promise.all( [
			page.waitForResponse(
				( resp ) =>
					resp.url().includes( '/beehiiv/v1/post-templates' ) &&
					resp.url().includes( pubId )
			),
			page.locator( PUB_SELECT ).selectOption( pubId ),
		] );
		expect( templatesResponse.status() ).toBe( 200 );

		await page.locator( TPL_SELECT ).selectOption( tplId );

		// A real click on the Settings API's own submit_button() output --
		// exactly the interaction the AC describes -- not a raw
		// options.php POST.
		await page.locator( '#submit' ).click();
		await page.waitForURL( /page=beehiiv/ );

		expect( readSettingsOption() ).toEqual( {
			publication_id: pubId,
			post_template_id: tplId,
		} );
	} );

	test( 'AC-013: new templates created in beehiiv appear when the user next loads the page after saving settings', async ( { page } ) => {
		seedConnectedAndAuthorized();
		const pubId = 'qa-e2e-pub-ac013';
		seedPublications( [ { id: pubId, name: 'QA Publication AC013' } ] );
		seedTemplates( pubId, [
			{ id: 'qa-e2e-tpl-ac013-old', name: 'QA Template AC013 Old' },
		] );
		setSettingsOption( pubId, '' );

		await page.goto( SETTINGS_PATH );
		await expect(
			page.locator( TPL_SELECT ).locator( 'option', { hasText: 'QA Template AC013 Old' } )
		).toHaveCount( 1 );

		// Save the form via a real click, same publication selected --
		// Options::sanitize() clears the per-publication template cache on
		// every save where publication_id is non-empty (BR-004), regardless
		// of whether the publication itself changed.
		await page.locator( '#submit' ).click();
		await page.waitForURL( /page=beehiiv/ );

		expect( readCachedTemplates( pubId ) ).toBeNull();

		// Stand in for "beehiiv now has a new template" the same way every
		// other test in this file substitutes for beehiiv's per-publication
		// data -- this environment has no live, authorized beehiiv account to
		// actually create one in.
		seedTemplates( pubId, [
			{ id: 'qa-e2e-tpl-ac013-new', name: 'QA Template AC013 New' },
		] );

		await page.goto( SETTINGS_PATH );
		await expect(
			page.locator( TPL_SELECT ).locator( 'option', { hasText: 'QA Template AC013 New' } )
		).toHaveCount( 1 );
		await expect(
			page.locator( TPL_SELECT ).locator( 'option', { hasText: 'QA Template AC013 Old' } )
		).toHaveCount( 0 );
	} );
} );
