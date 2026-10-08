const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/3-admin-options/settings-validation-cache.prd.md
 *
 * RE-RUN NOTE: a prior run of this spec found all 5 ACs browser-untestable.
 * `Options::sanitize()` (the registered `sanitize_callback` for the
 * `beehiiv_settings` option, which nests the `Cache::delete_post_templates()`
 * call these ACs also cover) only ever fires on a real POST to
 * `/wp-admin/options.php`, guarded by a nonce bound to the requesting
 * session's own auth-cookie session token. The only place the plugin renders
 * that nonce -- `includes/Admin/Views/settings-page.php`'s
 * `<form action="options.php">` via `settings_fields( 'beehiiv_settings' )`
 * -- was gated behind `Workspace::can_write_posts()`, a live beehiiv API
 * call this environment could never satisfy, so there was no page anywhere
 * that would hand a real browser session a working nonce for this action.
 *
 * Since then, `tests/e2e/plugins/beehiiv-options.php` (test-only mu-plugin,
 * wp-env *tests* environment only -- see `.wp-env.json`'s
 * `env.tests.mappings`) added `beehiiv_e2e_seed_connection()` (real
 * `TokenStore::save_tokens()`, so `Manager::is_connected()` is genuinely
 * true) and `beehiiv_e2e_mock_permissions()` (short-circuits just the one
 * `GET /workspaces/permissions` call, so `Workspace::can_write_posts()` is
 * genuinely true too). Together these make the gated form render for real,
 * for a real logged-in-via-`loginAsAdmin()` Playwright session -- confirmed
 * below by asserting `form[action="options.php"]` is present before every
 * test relies on it. That form's nonce is minted for *this* session's own
 * auth cookie, unlike a WP-CLI-minted one (which a prior investigation
 * proved WordPress core rejects, since WP-CLI's process has no auth cookie
 * to bind a session token to).
 *
 * All 5 ACs are exercised through real submissions to `/wp-admin/options.php`
 * using that session's own cookies (`page.request` shares the browsing
 * context's cookie jar) and the exact `option_page` / `action` / `_wpnonce`
 * / `_wp_http_referer` hidden-field values read straight out of that
 * session's own rendered page -- i.e. exactly what a real "Save settings"
 * click would send, constructed directly instead of driven through the
 * `<select>` elements so payloads a fixed option list can't carry (XSS
 * strings for AC-001/AC-002) and a non-array top-level `beehiiv_settings`
 * value (AC-003, which no `<select>`-based form submission can produce
 * either, since the fields' `name="beehiiv_settings[...]"` bracket syntax
 * always parses to a PHP array) can both be sent.
 *
 * Code paths under test:
 * - `includes/Admin/Options.php` `Options::sanitize()` -- AC-001..AC-005.
 * - `includes/API/Cache.php` `Cache::get_post_templates()` /
 *   `set_post_templates()` / `delete_post_templates()` -- the cache read
 *   after AC-004/AC-005's submissions.
 */

const OPTION_NAME = 'beehiiv_settings';
const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const OPTIONS_PHP_PATH = '/wp-admin/options.php';

/** Seeds a connected + write-authorized state via the test-only mu-plugin seam. */
function seedConnectedAndAuthorized() {
	wpCli(
		'eval \'beehiiv_e2e_seed_connection(); beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );\''
	);
}

/** Reads the current stored beehiiv_settings option as a parsed object (or null). */
function readSettingsOption() {
	const raw = wpCliSafe( `option get ${ OPTION_NAME } --format=json` );
	return raw ? JSON.parse( raw ) : null;
}

/**
 * Reads Cache::get_post_templates() for a publication via the real PHP read path.
 * @param {string} publicationId
 */
function readCachedTemplates( publicationId ) {
	const raw = wpCliSafe(
		`eval 'echo wp_json_encode( \\Beehiiv\\API\\Cache::get_post_templates( "${ publicationId }" ) );'`
	);
	return raw ? JSON.parse( raw ) : null;
}

/**
 * Navigates to the (now-rendering, thanks to the seeded connection) settings
 * page and reads the real hidden fields `settings_fields( 'beehiiv_settings' )`
 * outputs for the current browser session: `option_page`, `action`,
 * `_wpnonce`, and (when present -- `wp_get_referer()` doesn't always find
 * one on a direct `page.goto()` navigation) `_wp_http_referer`.
 * @param {import('@playwright/test').Page} page
 */
async function readSettingsFormNonceFields( page ) {
	await page.goto( SETTINGS_PATH );
	await expect( page.locator( 'form[action="options.php"]' ) ).toHaveCount(
		1
	);

	const fields = {
		option_page: await page
			.locator( 'input[name="option_page"]' )
			.inputValue(),
		action: await page.locator( 'input[name="action"]' ).inputValue(),
		_wpnonce: await page.locator( 'input[name="_wpnonce"]' ).inputValue(),
	};

	const refererField = page.locator( 'input[name="_wp_http_referer"]' );
	if ( ( await refererField.count() ) > 0 ) {
		fields._wp_http_referer = await refererField.inputValue();
	}

	return fields;
}

/**
 * POSTs directly to /wp-admin/options.php using the real session's own
 * cookies and a nonce read straight out of that same session's own rendered
 * page -- genuinely reachable by WordPress core's real Settings API dispatch
 * (`options.php` -> `update_option()` -> the `sanitize_option_beehiiv_settings`
 * filter -> `Options::sanitize()`), unlike a WP-CLI-minted nonce.
 * @param {import('@playwright/test').Page} page
 * @param {Object}                          nonceFields
 * @param {Object}                          extraFields
 */
function submitSettingsForm( page, nonceFields, extraFields ) {
	return page.request.post( OPTIONS_PHP_PATH, {
		form: { ...nonceFields, ...extraFields },
	} );
}

test.beforeAll( () => {
	ensurePluginActive();

	// Known clean baseline for every test in this file. This is wp-env's
	// dedicated *tests* environment (never dev/production), so there is no
	// real state worth preserving here; the only contract other agents'
	// specs need from this file is "leave beehiiv_settings absent", not
	// "restore whatever was here before" (which just perpetuates any
	// earlier run's leftovers).
	wpCliSafe( `option delete ${ OPTION_NAME }` );
} );

test.afterAll( () => {
	// Both steps are safe deletes (never throw, even if already absent), so
	// one failing step can never skip the other.
	wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	wpCliSafe( `option delete ${ OPTION_NAME }` );
} );

test.describe( 'Settings validation & cache management', () => {
	test.beforeEach( async ( { page } ) => {
		seedConnectedAndAuthorized();
		await loginAsAdmin( page );
	} );

	test.afterEach( () => {
		// Clears the permissions mock, OAuth connection, and every beehiiv
		// transient cache -- so nothing this file seeded leaks into whichever
		// agent's spec runs next against this shared tests environment.
		wpCliSafe( "eval 'beehiiv_e2e_reset_all();'" );
	} );

	test( 'AC-001: publication ID is sanitized as a text field before being saved', async ( {
		page,
	} ) => {
		const nonceFields = await readSettingsFormNonceFields( page );
		const rawPublicationId =
			'<script>window.__qaXss=1;</script>qa-e2e-pub-xss';

		const response = await submitSettingsForm( page, nonceFields, {
			'beehiiv_settings[publication_id]': rawPublicationId,
			'beehiiv_settings[post_template_id]': '',
		} );
		expect( response.ok() ).toBe( true );

		const saved = readSettingsOption();
		expect( saved.publication_id ).not.toContain( '<script>' );
		expect( saved.publication_id ).not.toContain( '</script>' );
		expect( saved.publication_id ).toContain( 'qa-e2e-pub-xss' );
	} );

	test( 'AC-002: post template ID is sanitized as a text field before being saved', async ( {
		page,
	} ) => {
		const nonceFields = await readSettingsFormNonceFields( page );
		const rawTemplateId = '<b>bold</b>qa-e2e-tmpl-xss';

		const response = await submitSettingsForm( page, nonceFields, {
			'beehiiv_settings[publication_id]': '',
			'beehiiv_settings[post_template_id]': rawTemplateId,
		} );
		expect( response.ok() ).toBe( true );

		const saved = readSettingsOption();
		expect( saved.post_template_id ).not.toContain( '<b>' );
		expect( saved.post_template_id ).not.toContain( '</b>' );
		expect( saved.post_template_id ).toContain( 'qa-e2e-tmpl-xss' );
	} );

	test( 'AC-003: if input is not an array, the save is aborted and current settings are retained', async ( {
		page,
	} ) => {
		// Establish a known-good baseline through a real, valid save first.
		let nonceFields = await readSettingsFormNonceFields( page );
		await submitSettingsForm( page, nonceFields, {
			'beehiiv_settings[publication_id]': 'qa-e2e-pub-baseline',
			'beehiiv_settings[post_template_id]': 'qa-e2e-tmpl-baseline',
		} );
		const baseline = readSettingsOption();
		expect( baseline ).toEqual( {
			publication_id: 'qa-e2e-pub-baseline',
			post_template_id: 'qa-e2e-tmpl-baseline',
		} );

		// Submit `beehiiv_settings` as a flat (non-bracketed) field, so PHP
		// parses $_POST['beehiiv_settings'] as a plain string rather than an
		// array -- Options::sanitize()'s `is_array( $input )` guard should
		// reject it and return the current settings unchanged, instead of the
		// `<select>` fields' bracket-syntax names, which always parse to an
		// array and so cannot exercise this guard at all.
		nonceFields = await readSettingsFormNonceFields( page );
		await submitSettingsForm( page, nonceFields, {
			beehiiv_settings: 'not-an-array',
		} );

		expect( readSettingsOption() ).toEqual( baseline );
	} );

	test( 'AC-004: post template cache is cleared when publication ID is set to a non-empty value', async ( {
		page,
	} ) => {
		const publicationId = 'qa-e2e-pub-cache-clear';
		wpCli(
			`eval '\\Beehiiv\\API\\Cache::set_post_templates( "${ publicationId }", [ [ "id" => "tpl_1", "name" => "QA Template" ] ] );'`
		);
		expect( readCachedTemplates( publicationId ) ).not.toBeNull();

		const nonceFields = await readSettingsFormNonceFields( page );
		const response = await submitSettingsForm( page, nonceFields, {
			'beehiiv_settings[publication_id]': publicationId,
			'beehiiv_settings[post_template_id]': '',
		} );
		expect( response.ok() ).toBe( true );

		expect( readCachedTemplates( publicationId ) ).toBeNull();
	} );

	test( 'AC-005: post template cache is not cleared when publication ID is empty', async ( {
		page,
	} ) => {
		const publicationId = 'qa-e2e-pub-cache-keep';
		wpCli(
			`eval '\\Beehiiv\\API\\Cache::set_post_templates( "${ publicationId }", [ [ "id" => "tpl_1", "name" => "QA Template" ] ] );'`
		);
		expect( readCachedTemplates( publicationId ) ).not.toBeNull();

		const nonceFields = await readSettingsFormNonceFields( page );
		const response = await submitSettingsForm( page, nonceFields, {
			'beehiiv_settings[publication_id]': '',
			'beehiiv_settings[post_template_id]': '',
		} );
		expect( response.ok() ).toBe( true );

		// Unrelated to the publication ID just submitted (which was empty) --
		// still cached, proving Options::sanitize() skipped the
		// Cache::delete_post_templates() call entirely.
		expect( readCachedTemplates( publicationId ) ).not.toBeNull();
	} );
} );
