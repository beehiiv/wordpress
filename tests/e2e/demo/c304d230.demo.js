// @demo-acs AC-013 AC-014 AC-015 AC-016 AC-017 AC-018 AC-019
/**
 * One-take demo for intake c304d230: setting to require editors to pick a post
 * template (PRD admin-interface/publication-template-config,
 * newsletter-publishing/post-template-selection and
 * editor-integration/newsletter-template-selection).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with the tests-environment seams the QA specs use
 * (tests/e2e/plugins/beehiiv-options.php). Every action in the video goes
 * through the real UI; wp-cli only seeds data and reads back state.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const { execSync } = require( 'child_process' );
const kit = require( './kit' );

const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUBLICATION_ID = 'pub_qa_e2e_nts';
const DEFAULT_TEMPLATE = 'tpl_qa_e2e_nts_default';
const OTHER_TEMPLATE = 'tpl_qa_e2e_nts_other';
const REQUIRED_MESSAGE =
	'Choose a post template before sending this post to beehiiv.';
const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const TOGGLE = '#beehiiv_require_template_choice';
const SIDEBAR = '.beehiiv-post-settings';
const STATE = path.join( os.tmpdir(), 'demo-c304d230-auth.json' );
const ids = {};

const b64 = ( v ) => Buffer.from( JSON.stringify( v ) ).toString( 'base64' );
const evalWith = ( payload, code ) =>
	wp.wpCli(
		`eval '$a = json_decode( base64_decode( "${ b64(
			payload
		) }" ), true ); ${ code }'`
	);

/**
 * Seeds a connected site with one publication, two templates and the
 * require-template setting left unset (off by default).
 */
function seed() {
	evalWith(
		{},
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [
			"publication_id" => "${ PUBLICATION_ID }",
			"post_template_id" => "${ DEFAULT_TEMPLATE }",
		] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [
			[ "id" => "${ DEFAULT_TEMPLATE }", "name" => "QA Default Template" ],
			[ "id" => "${ OTHER_TEMPLATE }", "name" => "QA Other Template" ],
		] );
		beehiiv_e2e_mock_http( "/post_templates", [ "body" => [ "data" => [
			[ "id" => "${ DEFAULT_TEMPLATE }", "name" => "QA Default Template" ],
			[ "id" => "${ OTHER_TEMPLATE }", "name" => "QA Other Template" ],
		] ] ] );
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "post_qa_e2e_nts_created" ] ] ] );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a never-sent draft with "Send to newsletter" on and returns its ID.
 *
 * @param {string} title Post title.
 * @return {string} The new post ID.
 */
function createPost( title ) {
	return evalWith(
		{
			post: {
				post_type: 'post',
				post_title: title,
				post_content:
					'<!-- wp:paragraph --><p>Everything we shipped this quarter, in one place.</p><!-- /wp:paragraph -->',
				post_status: 'draft',
				post_author: 1,
			},
		},
		`$id = wp_insert_post( $a["post"] );
		update_post_meta( $id, "_beehiiv_send_to_newsletter", "1" );
		echo $id . "\\n";`
	).trim();
}

/**
 * Reads the stored value of the require-template setting.
 *
 * @return {boolean} The stored setting.
 */
function storedSetting() {
	const out = wp.wpCli(
		`eval '$s = get_option( "beehiiv_settings" ); echo "V=" . ( ! empty( $s["require_template_choice"] ) ? "1" : "0" );'`
	);
	return /V=1/.test( out );
}

/**
 * Create-post calls the plugin made to beehiiv since the log was last cleared.
 *
 * @return {string[]} URLs of POST .../posts calls.
 */
function createCalls() {
	const out = wp.wpCli(
		`eval 'echo "JSON=" . wp_json_encode( array_values( (array) get_option( "beehiiv_e2e_http_log", [] ) ) );'`
	);
	return JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) )
		.filter(
			( e ) =>
				e.method === 'POST' &&
				/\/publications\/[^/]+\/posts/.test( e.url )
		)
		.map( ( e ) => e.url );
}

/**
 * Opens a post in the editor with the beehiiv sidebar and template field shown.
 *
 * @param {import('@playwright/test').Page} page   Page.
 * @param {string}                          postId Post ID.
 * @param {boolean}                         field  Wait for the template field, not just the panel.
 * @return {Promise<import('@playwright/test').Locator>} The beehiiv sidebar.
 */
async function openSidebarFor( page, postId, field = true ) {
	await kit.openPostEditor( page, postId );
	const sidebar = page.locator( SIDEBAR );
	// The editor remembers an open plugin sidebar, so only click when closed.
	const toggle = page
		.getByRole( 'button', { name: 'beehiiv', exact: true } )
		.first();
	await toggle.waitFor( { state: 'visible', timeout: 15000 } );
	const open =
		( await toggle.getAttribute( 'aria-expanded' ) ) === 'true' ||
		( await toggle.getAttribute( 'aria-pressed' ) ) === 'true';
	if ( ! open ) {
		await toggle.click();
	}
	await expect(
		field
			? sidebar.getByLabel( 'Post template' )
			: page.locator( '.beehiiv-post-settings-content' )
	).toBeVisible( { timeout: 20000 } );
	return sidebar;
}

/**
 * Publishes the open post through the real editor save path.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function publish( page ) {
	await page.evaluate( async () => {
		const { dispatch } = window.wp.data;
		dispatch( 'core/editor' ).editPost( { status: 'publish' } );
		await dispatch( 'core/editor' ).savePost();
	} );
}

/**
 * Sets the settings-page toggle through the UI and saves.
 *
 * @param {import('@playwright/test').Page} page Page.
 * @param {boolean}                         on   Wanted state.
 */
async function setToggle( page, on ) {
	await glideClick( page, page.locator( TOGGLE ) );
	await expect( page.locator( TOGGLE ) ).toBeChecked( { checked: on } );
	await page.waitForTimeout( 1500 );
	await glideClick( page, page.locator( '#submit' ) );
	await page.waitForURL( /page=beehiiv/ );
	await expect( page.locator( TOGGLE ) ).toBeChecked( { checked: on } );
}

test.use( { storageState: STATE, viewport: { width: 1280, height: 720 } } );

test.beforeAll( async ( { browser } ) => {
	wp.ensurePluginActive();
	seed();
	ids.first = createPost( 'Quarterly roundup' );
	ids.second = createPost( 'Product launch notes' );
	ids.third = createPost( 'Holiday sale announcement' );
	// Log in before recording starts, so the video opens on the product.
	const ctx = await browser.newContext( {
		storageState: undefined,
		baseURL: process.env.WP_BASE_URL || 'http://localhost:8891',
	} );
	const page = await ctx.newPage();
	await kit.loginAsAdmin( page );
	await ctx.storageState( { path: STATE } );
	await ctx.close();
} );

test.afterAll( () => {
	evalWith(
		{ ids: Object.values( ids ) },
		`foreach ( $a["ids"] as $id ) { wp_delete_post( (int) $id, true ); }
		delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();`
	);
	fs.rmSync( STATE, { force: true } );
} );

test( 'Require editors to choose a post template: full walkthrough', async ( {
	page,
} ) => {
	await installOverlay( page );
	const build = execSync( 'git rev-parse --short HEAD', {
		cwd: path.resolve( __dirname, '../../..' ),
	} )
		.toString()
		.trim();

	// 1. Settings: turn the requirement on --------------------------------------
	await page.goto( SETTINGS_PATH );
	await expect( page.locator( TOGGLE ) ).toBeVisible();
	// Keep the toggle clear of the caption bar at the bottom of the screen.
	await page
		.locator( TOGGLE )
		.evaluate( ( el ) => el.scrollIntoView( { block: 'center' } ) );
	await caption(
		page,
		`Require editors to choose a post template · beehiiv plugin build ${ build }`,
		3500
	);
	await expect( page.locator( TOGGLE ) ).not.toBeChecked();
	await caption(
		page,
		'1/4 · Plugin Settings has a new toggle: "Require editors to choose a post template". It is off by default (AC-014, AC-015)',
		1200
	);
	await point(
		page,
		page.getByLabel( 'Require editors to choose a post template' ),
		4500
	);
	const help = page
		.locator( 'td' )
		.filter( { has: page.locator( TOGGLE ) } )
		.locator( 'p.description' );
	await expect( help ).toContainText(
		'sending is blocked until a template is chosen'
	);
	await caption(
		page,
		'The help text explains the rule: the default template is not applied automatically, and sending is blocked until a template is chosen (AC-017)',
		1200
	);
	await point( page, help, 5500 );
	await caption( page, 'Turn it on and save', 1000 );
	await setToggle( page, true );
	expect( storedSetting() ).toBe( true );
	await caption(
		page,
		'The setting is saved and stays on after the page reloads (AC-016)',
		4000
	);

	// 2. Editor: the template field starts empty --------------------------------
	await caption(
		page,
		'2/4 · A new post that has never been sent to beehiiv',
		0
	);
	let sidebar = await openSidebarFor( page, ids.first );
	const select = sidebar.getByLabel( 'Post template' );
	await expect( select ).toHaveValue( '' );
	await expect( select.locator( 'option:checked' ) ).toHaveText(
		'Choose a template'
	);
	await caption(
		page,
		'The Post template field starts empty with the prompt "Choose a template". No default is pre-selected (AC-014)',
		1200
	);
	await point( page, select, 4500 );
	await expect(
		select.locator( 'option', {
			hasText: 'Default (from beehiiv settings)',
		} )
	).toHaveCount( 0 );
	await caption(
		page,
		'The "Default (from beehiiv settings)" option is not offered. Real templates stay selectable (AC-015)',
		4500
	);
	const helpText = sidebar
		.locator( '.beehiiv-newsletter-template' )
		.locator( '.components-base-control__help' );
	await expect( helpText ).toHaveText( REQUIRED_MESSAGE );
	await point( page, helpText, 800 );
	await caption(
		page,
		'Help text under the field asks the editor to choose a post template (AC-016)',
		4500
	);

	// 3. Publishing without a template is blocked --------------------------------
	await caption( page, '3/4 · Publish without choosing a template', 1500 );
	await publish( page );
	sidebar = await openSidebarFor( page, ids.first, false );
	const errorNotice = sidebar
		.locator( '.components-notice.is-error' )
		.filter( { hasText: REQUIRED_MESSAGE } )
		.first();
	await expect( errorNotice ).toBeVisible();
	expect( createCalls() ).toEqual( [] );
	await point( page, errorNotice, 800 );
	await caption(
		page,
		'The send is blocked with an error notice, even though a default template exists. Nothing is sent to beehiiv (AC-013, AC-017)',
		6000
	);

	// 4. Choosing a template lets the send continue -------------------------------
	sidebar = await openSidebarFor( page, ids.second );
	const select2 = sidebar.getByLabel( 'Post template' );
	await expect( sidebar.getByText( REQUIRED_MESSAGE ).first() ).toBeVisible();
	await caption(
		page,
		'Another new post. The editor picks "QA Other Template"',
		1200
	);
	await glideClick( page, select2 );
	await select2.selectOption( OTHER_TEMPLATE );
	await expect( select2 ).toHaveValue( OTHER_TEMPLATE );
	await expect( sidebar.getByText( REQUIRED_MESSAGE ) ).toHaveCount( 0 );
	await caption(
		page,
		'The prompt and help text clear as soon as a template is chosen (AC-018)',
		4500
	);
	await publish( page );
	await expect
		.poll( () => createCalls().length, { timeout: 20000 } )
		.toBe( 1 );
	expect( createCalls()[ 0 ] ).toContain(
		`/publications/${ PUBLICATION_ID }/posts`
	);
	await caption(
		page,
		'With a template chosen, the send continues. The newsletter is created in beehiiv (AC-017)',
		5000
	);

	// 5. Setting off: behavior is unchanged ---------------------------------------
	await caption( page, '4/4 · Turn the setting off again', 1200 );
	await page.goto( SETTINGS_PATH );
	await setToggle( page, false );
	expect( storedSetting() ).toBe( false );
	sidebar = await openSidebarFor( page, ids.third );
	const select3 = sidebar.getByLabel( 'Post template' );
	await expect( select3 ).toHaveValue( DEFAULT_TEMPLATE );
	await expect( sidebar.getByText( REQUIRED_MESSAGE ) ).toHaveCount( 0 );
	await point( page, select3, 800 );
	await caption(
		page,
		'With the setting off, new posts use the default template and show no prompt, as before (AC-019)',
		5500
	);
	await caption( page, 'End of walkthrough', 2500 );
} );
