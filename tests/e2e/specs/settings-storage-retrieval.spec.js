const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/3-admin-options/settings-storage-retrieval.prd.md
 *
 * Scope note: this PRD is brownfield-mapped and explicitly puts "Settings
 * page UI or form rendering" and "Admin screen registration or display" out
 * of scope (belongs to a separate admin UI feature). The Settings API form
 * on the beehiiv settings screen is itself gated behind a live OAuth
 * connection (`Manager::is_connected()`) and workspace permissions
 * (`Workspace::can_write_posts()`), which this environment cannot establish
 * without a real beehiiv account -- so these specs cannot submit the
 * wp-admin settings form directly.
 *
 * Instead they exercise the real storage/retrieval mechanism this PRD
 * *does* own -- `Beehiiv\Admin\Options::get()` (includes/Admin/Options.php)
 * -- through a code path that runs unconditionally (no OAuth gate):
 * `Beehiiv\Editor\PostSettings::get_editor_config()`
 * (includes/Editor/PostSettings.php) calls `Options::get()` directly and
 * exposes the result to the browser via `wp_localize_script()` as the
 * `window.beehiivPostSettings` global on the classic post editor screen,
 * loaded fresh on every page request. Reading that global after wp-cli
 * seeds/corrupts the underlying `beehiiv_settings` option is a genuine
 * browser-driven, full-request-cycle exercise of the PRD's retrieval
 * mechanism -- just not through the settings form UI (a different PRD's
 * scope).
 */

const OPTION_NAME = 'beehiiv_settings';
const FIXTURE_POST_TITLE = 'QA E2E Settings Storage Retrieval Fixture';

const EXPECTED_KEYS = [
	'isConnected',
	'canWritePosts',
	'appUrl',
	'settingsUrl',
	'pricingUrl',
	'hasPublication',
	'hasPostTemplate',
	'publicationId',
	'defaultPostTemplateId',
	'canPublishPosts',
].sort();

let fixturePostId;

/**
 * Reads window.beehiivPostSettings after navigating to the post editor.
 * @param {import('@playwright/test').Page} page
 * @param {number|string}                   postId
 */
async function readEditorConfig( page, postId ) {
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
	await page.waitForFunction(
		() => window.beehiivPostSettings !== undefined,
		null,
		{ timeout: 15000 }
	);
	return page.evaluate( () => window.beehiivPostSettings );
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

	// Idempotent fixture post -- reuse across repeated runs against this
	// shared environment (same pattern as menu-registration.spec.js's fixture
	// user), rather than creating a new post every run.
	const existing = wpCliSafe(
		`post list --post_type=post --title=${ JSON.stringify(
			FIXTURE_POST_TITLE
		) } --field=ID`
	);
	if ( existing ) {
		fixturePostId = existing.split( '\n' )[ 0 ].trim();
	} else {
		fixturePostId = wpCli(
			`post create --post_type=post --post_status=draft ` +
				`--post_title=${ JSON.stringify(
					FIXTURE_POST_TITLE
				) } --porcelain`
		).trim();
	}
} );

test.afterAll( () => {
	wpCliSafe( `option delete ${ OPTION_NAME }` );
} );

test.describe( 'Settings storage & retrieval', () => {
	test( 'AC-001: publication ID and post template ID are retained when retrieved after being saved', async ( {
		page,
	} ) => {
		wpCli(
			`option update ${ OPTION_NAME } ` +
				`'{"publication_id":"qa-ac1-pub","post_template_id":"qa-ac1-tmpl"}' --format=json`
		);

		await loginAsAdmin( page );
		const config = await readEditorConfig( page, fixturePostId );

		expect( config.publicationId ).toBe( 'qa-ac1-pub' );
		expect( config.defaultPostTemplateId ).toBe( 'qa-ac1-tmpl' );
	} );

	test( 'AC-002: settings persist across page reloads and separate server requests', async ( {
		page,
	} ) => {
		wpCli(
			`option update ${ OPTION_NAME } ` +
				`'{"publication_id":"qa-ac2-pub","post_template_id":"qa-ac2-tmpl"}' --format=json`
		);

		await loginAsAdmin( page );

		const firstLoad = await readEditorConfig( page, fixturePostId );
		expect( firstLoad.publicationId ).toBe( 'qa-ac2-pub' );
		expect( firstLoad.defaultPostTemplateId ).toBe( 'qa-ac2-tmpl' );

		// Navigate away and back in, forcing an entirely separate server
		// request/PHP process, not a client-side re-render.
		await page.goto( '/wp-admin/index.php' );
		const secondLoad = await readEditorConfig( page, fixturePostId );

		expect( secondLoad.publicationId ).toBe( 'qa-ac2-pub' );
		expect( secondLoad.defaultPostTemplateId ).toBe( 'qa-ac2-tmpl' );
	} );

	test( 'AC-003: settings are always retrieved in a consistent object structure', async ( {
		page,
	} ) => {
		// One pass with values saved, one pass with none -- the object's key
		// set and value types must stay identical either way.
		wpCli(
			`option update ${ OPTION_NAME } ` +
				`'{"publication_id":"qa-ac3-pub","post_template_id":"qa-ac3-tmpl"}' --format=json`
		);

		await loginAsAdmin( page );
		const withValues = await readEditorConfig( page, fixturePostId );

		wpCliSafe( `option delete ${ OPTION_NAME }` );
		const withoutValues = await readEditorConfig( page, fixturePostId );

		expect( Object.keys( withValues ).sort() ).toEqual( EXPECTED_KEYS );
		expect( Object.keys( withoutValues ).sort() ).toEqual( EXPECTED_KEYS );

		// `wp_localize_script()` (WP core) coerces every scalar value to a
		// string when it injects the object into the page -- `hasPublication`
		// / `hasPostTemplate` come out of PHP as real booleans (verified by
		// reading includes/Editor/PostSettings.php::get_editor_config()) but
		// arrive in the browser as `"1"` / `""`. That's a property of the
		// transport, not of Options::get()'s own return type, so assert the
		// *actual* browser-visible shape (all string-valued) is identical
		// across both states, which is what "consistent object structure"
		// means from the browser's point of view.
		expect( typeof withValues.publicationId ).toBe( 'string' );
		expect( typeof withValues.defaultPostTemplateId ).toBe( 'string' );
		expect( typeof withValues.hasPublication ).toBe( 'string' );
		expect( typeof withValues.hasPostTemplate ).toBe( 'string' );

		expect( typeof withoutValues.publicationId ).toBe( 'string' );
		expect( typeof withoutValues.defaultPostTemplateId ).toBe( 'string' );
		expect( typeof withoutValues.hasPublication ).toBe( 'string' );
		expect( typeof withoutValues.hasPostTemplate ).toBe( 'string' );
	} );

	test( 'AC-004: settings are returned as a complete object even on first retrieval before any save', async ( {
		page,
	} ) => {
		wpCliSafe( `option delete ${ OPTION_NAME }` );

		await loginAsAdmin( page );
		const config = await readEditorConfig( page, fixturePostId );

		expect( Object.keys( config ).sort() ).toEqual( EXPECTED_KEYS );
		expect( config.publicationId ).toBe( '' );
		expect( config.defaultPostTemplateId ).toBe( '' );
		// See the note in the AC-003 test: `wp_localize_script()` transports
		// PHP booleans as `"1"` / `""`, so `false` arrives as `''` here.
		expect( config.hasPublication ).toBe( '' );
		expect( config.hasPostTemplate ).toBe( '' );
	} );

	test( 'AC-005: missing or never-set configuration values default to empty strings', async ( {
		page,
	} ) => {
		// Explicitly save an empty settings object (no publication_id /
		// post_template_id keys at all), rather than deleting the option --
		// this exercises the default-merge path specifically, distinct from
		// AC-004's option-row-absent path.
		wpCli( `option update ${ OPTION_NAME } '{}' --format=json` );

		await loginAsAdmin( page );
		const config = await readEditorConfig( page, fixturePostId );

		expect( config.publicationId ).toBe( '' );
		expect( config.defaultPostTemplateId ).toBe( '' );
	} );

	test( 'AC-006: invalid or corrupted data in storage does not prevent settings from being retrieved', async ( {
		page,
	} ) => {
		// Store a plain (non-array) scalar in place of the expected array --
		// `wp option update` without --format=json stores the raw string,
		// matching the Edge Cases table's "non-array or corrupted data".
		wpCli(
			`option update ${ OPTION_NAME } "qa-ac6-corrupted-not-an-array"`
		);

		await loginAsAdmin( page );
		const response = await page.goto(
			`/wp-admin/post.php?post=${ fixturePostId }&action=edit`
		);
		expect( response.status() ).toBe( 200 );

		await page.waitForFunction(
			() => window.beehiivPostSettings !== undefined,
			null,
			{ timeout: 15000 }
		);
		const config = await page.evaluate( () => window.beehiivPostSettings );

		expect( Object.keys( config ).sort() ).toEqual( EXPECTED_KEYS );
		expect( config.publicationId ).toBe( '' );
		expect( config.defaultPostTemplateId ).toBe( '' );
		// See the note in the AC-003 test re: wp_localize_script's string
		// coercion of PHP booleans.
		expect( config.hasPublication ).toBe( '' );
		expect( config.hasPostTemplate ).toBe( '' );
	} );
} );
