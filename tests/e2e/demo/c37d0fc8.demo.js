// @demo-acs AC-001 AC-002 AC-003 AC-005 AC-008 AC-009 AC-013 AC-018 AC-019 AC-020 AC-023
/**
 * One-take demo for intake c37d0fc8: send test emails through the beehiiv
 * test-send endpoint (PRD-06.5.01). Built for the build the intake handed to
 * UAT (ab1f909).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with the tests-environment seams the QA spec uses
 * (tests/e2e/plugins/beehiiv-options.php). Every action in the video goes
 * through the real editor UI; wp-cli only seeds data and reads back which
 * calls the plugin made to beehiiv.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const kit = require( './kit' );

const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUB = 'pub_e2e';
const TPL = 'tpl_e2e';
const TMP_ID = 'post_tmp_e2e';
const SITE_TZ = 'America/New_York';
const STATE = path.join( os.tmpdir(), 'demo-c37d0fc8-auth.json' );
const ids = [];

const b64 = ( v ) => Buffer.from( v ).toString( 'base64' );
const arg = ( v ) =>
	`json_decode( base64_decode( "${ b64( JSON.stringify( v ) ) }" ), true )`;
const php = ( code ) =>
	wp.wpCli( `eval 'eval( base64_decode( "${ b64( code ) }" ) );'` );

/**
 * Seeds a connected, ready site and an empty request log.
 */
function seed() {
	php( `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( ${ arg( { posts: [ 'read', 'write' ] } ) } );
		remove_all_filters( "sanitize_option_beehiiv_settings" );
		update_option( "beehiiv_settings", ${ arg( {
			publication_id: PUB,
			post_template_id: TPL,
		} ) } );
		delete_option( "beehiiv_test_send_reset_at" );
		update_option( "timezone_string", "${ SITE_TZ }" );
	` );
}

/**
 * Registers beehiiv post-endpoint mocks for create, test send, delete and get.
 *
 * @param {Object} testSend Response for POST .../test_sends.
 */
function mockBeehiiv( testSend ) {
	const mocks = {
		test_sends: {
			pattern: '#/publications/[^/]+/posts/[^/?]+/test_sends(\\?|$)#',
			method: 'POST',
			...testSend,
		},
		create_post: {
			pattern: '#/publications/[^/]+/posts(\\?|$)#',
			method: 'POST',
			status: 201,
			body: { data: { id: TMP_ID } },
		},
		delete_post: {
			pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
			method: 'DELETE',
			status: 204,
			body: '',
		},
		get_post: {
			pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
			method: 'GET',
			status: 200,
			body: { data: { id: TMP_ID } },
		},
	};
	php( `
		foreach ( ${ arg(
			mocks
		) } as $key => $mock ) { beehiiv_e2e_mock_http( $key, $mock ); }
		beehiiv_e2e_clear_http_log();
	` );
}

/**
 * Creates a post straight in the database and returns its ID.
 *
 * @param {string} title  Post title.
 * @param {string} status Post status.
 * @return {number} The new post ID.
 */
function createPost( title, status = 'draft' ) {
	const content =
		'<!-- wp:paragraph --><p>Our October update: three things worth knowing.</p><!-- /wp:paragraph -->';
	const out = php( `
		$id = wp_insert_post( ${ arg( {
			post_type: 'post',
			post_title: title,
			post_content: content,
			post_status: status,
		} ) } );
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	ids.push( id );
	return id;
}

/**
 * Mocked beehiiv calls the plugin made, as "METHOD name" in order, with bodies.
 *
 * @return {Array} Log entries.
 */
function httpLog() {
	const out = php(
		'echo "JSON=" . wp_json_encode( array_values( (array) get_option( "beehiiv_e2e_http_log", [] ) ) );'
	);
	return JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) ).filter(
		( e ) => e.mock !== '/workspaces/permissions'
	);
}

const section = ( page ) => page.locator( '.beehiiv-test-email' );
const recipients = ( page ) => page.getByLabel( 'Send test email to' );
const sendButton = ( page ) =>
	page.getByRole( 'button', { name: 'Send test email', exact: true } );

/**
 * Opens a post in the editor with the beehiiv panel visible.
 *
 * @param {import('@playwright/test').Page} page   Page.
 * @param {number}                          postId Post ID.
 */
async function openPanel( page, postId ) {
	await kit.openPostEditor( page, postId );
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
		page.locator( '.beehiiv-post-settings-content' )
	).toBeVisible();
}

test.use( { storageState: STATE, viewport: { width: 1280, height: 720 } } );

test.beforeAll( async ( { browser } ) => {
	wp.ensurePluginActive();
	wp.ensurePrettyPermalinks();
	seed();
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
	php( `
		foreach ( array_filter( explode( ",", "${ ids.join(
			','
		) }" ) ) as $id ) { wp_delete_post( (int) $id, true ); }
		beehiiv_e2e_reset_all();
		delete_option( "beehiiv_settings" );
		delete_option( "beehiiv_test_send_reset_at" );
		update_option( "timezone_string", "" );
	` );
	fs.rmSync( STATE, { force: true } );
} );

test( 'Send test emails from the post editor: full walkthrough', async ( {
	page,
} ) => {
	await installOverlay( page );
	const resetAt = Math.floor( Date.now() / 1000 ) + 6 * 3600 + 17 * 60;
	mockBeehiiv( {
		status: 200,
		body: { data: { remaining_test_sends: 7, reset_at: resetAt } },
	} );

	// 1. A draft: send a test email ---------------------------------------------
	const draftId = createPost( 'October update' );
	await openPanel( page, draftId );
	await caption(
		page,
		'Send test emails through beehiiv · plugin build ab1f909',
		3500
	);
	await caption(
		page,
		'1/4 · A draft post. The beehiiv panel has a "Send test email" section (AC-001)',
		1200
	);
	await point( page, section( page ), 2500 );
	await expect( recipients( page ) ).toHaveValue( '' );
	await caption(
		page,
		'The recipients field starts empty. There is no default address (AC-002)',
		1200
	);
	await point( page, recipients( page ), 3000 );

	await caption(
		page,
		'Type addresses separated by commas or new lines, with extra spaces and a duplicate (AC-003)',
		1200
	);
	await glideClick( page, recipients( page ) );
	await recipients( page ).fill(
		'  editor@example.com , reviewer@example.com\n\nowner@example.com,editor@example.com  '
	);
	await page.waitForTimeout( 3500 );
	await glideClick( page, sendButton( page ) );
	await expect( section( page ) ).toContainText( 'Test email sent.', {
		timeout: 20000,
	} );

	const calls = httpLog();
	expect( calls.map( ( c ) => `${ c.method } ${ c.mock }` ) ).toEqual( [
		'POST create_post',
		'GET get_post',
		'POST test_sends',
		'DELETE delete_post',
	] );
	expect( calls[ 0 ].body.status ).toBe( 'draft' );
	expect( calls[ 0 ].body ).not.toHaveProperty( 'scheduled_at' );
	expect( calls[ 2 ].body.recipient_emails ).toEqual( [
		'editor@example.com',
		'reviewer@example.com',
		'owner@example.com',
	] );
	await caption(
		page,
		'beehiiv gets 3 addresses: spaces trimmed, the duplicate removed (AC-003)',
		4000
	);
	await caption(
		page,
		'A draft has no beehiiv newsletter yet. The plugin creates a temporary beehiiv draft, sends the test, then deletes it (AC-008, AC-009)',
		5500
	);
	await point( page, section( page ), 800 );
	await expect( section( page ) ).toContainText( '7 test sends left today.' );
	await caption(
		page,
		'The editor sees how many test sends are left today and when the limit resets, in the site timezone (AC-018)',
		5500
	);

	// 2. Unsaved edits ----------------------------------------------------------
	await caption(
		page,
		'2/4 · The test uses the saved post. Edit the title without saving…',
		1200
	);
	const title = page
		.frameLocator( 'iframe[name="editor-canvas"]' )
		.locator( '.editor-post-title__input, [aria-label="Add title"]' )
		.first();
	await glideClick( page, title );
	await page.keyboard.press( 'End' );
	await page.keyboard.type( ' (draft 2)', { delay: 90 } );
	await expect( section( page ) ).toContainText(
		'Save the post to include your latest edits.'
	);
	await expect( sendButton( page ) ).toBeDisabled();
	await caption(
		page,
		'Send is disabled until the post is saved. The plugin never saves for the editor (AC-005)',
		5000
	);
	await page.evaluate( async () => {
		await window.wp.data.dispatch( 'core/editor' ).savePost();
	} );
	await expect( sendButton( page ) ).toBeEnabled( { timeout: 15000 } );
	await caption( page, 'After saving, Send is available again', 2500 );

	// 3. Daily limit reached ------------------------------------------------------
	mockBeehiiv( {
		status: 422,
		body: { errors: [ { message: 'Daily limit' } ] },
	} );
	await caption( page, '3/4 · When the daily limit is reached…', 1200 );
	const typed = 'editor@example.com, reviewer@example.com';
	await glideClick( page, recipients( page ) );
	await recipients( page ).fill( typed );
	await glideClick( page, sendButton( page ) );
	await expect( section( page ) ).toContainText(
		"You've used all test sends for today.",
		{ timeout: 20000 }
	);
	await expect( section( page ) ).toContainText( 'They reset on' );
	await caption(
		page,
		'The editor sees that all sends are used, with the reset time remembered from the last send (AC-019, AC-020)',
		5500
	);
	await expect( recipients( page ) ).toHaveValue( typed );
	await point( page, recipients( page ), 800 );
	await caption(
		page,
		'The typed addresses stay in the field so the editor can try again (AC-023)',
		4500
	);

	// 4. Published posts cannot send tests ----------------------------------------
	const publishedId = createPost( 'Already published post', 'publish' );
	await caption( page, '4/4 · A published post', 0 );
	await openPanel( page, publishedId );
	await expect( section( page ) ).toContainText(
		'Test emails are available for drafts, pending posts, and scheduled posts.'
	);
	await expect( sendButton( page ) ).toHaveCount( 0 );
	await point( page, section( page ), 800 );
	await caption(
		page,
		'No send control. A short reason is shown instead (AC-013)',
		5000
	);
	await caption( page, 'End of walkthrough', 2500 );
} );
