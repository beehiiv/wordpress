// @demo-acs AC-001 AC-002 AC-003 AC-005 AC-008 AC-010 AC-013 AC-015
/**
 * One-take demo for intake 862095db: email preview in the WordPress post
 * editor (PRD-06.5.02 Email Preview).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with the tests-environment seams the QA spec uses
 * (tests/e2e/plugins/beehiiv-options.php). beehiiv itself is mocked: the
 * rendered email below stands in for the real beehiiv email. Every action in
 * the video goes through the real editor UI; wp-cli only seeds data and reads
 * back which calls the plugin made to beehiiv.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const { execSync } = require( 'child_process' );
const kit = require( './kit' );
const { saveDraft } = require( '../utils/editor' );

const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUB = 'pub_e2e';
const TPL = 'tpl_e2e';
const DRAFT_ID = 'post_preview_e2e';
const LINKED_ID = 'post_linked_e2e';
const ORIGIN = 'http://localhost:8891';
const STATE = path.join( os.tmpdir(), 'demo-862095db-auth.json' );
const ids = {};

const EMAIL_HTML =
	'<html><body style="margin:0;background:#f4f1ec;font-family:Georgia,serif;color:#222">' +
	'<div style="max-width:560px;margin:0 auto;background:#fff">' +
	'<div style="background:#1f3a5f;color:#fff;padding:22px 28px;font:700 22px system-ui,sans-serif">The Acme Weekly</div>' +
	'<div style="padding:28px">' +
	'<h1 style="font-size:28px;margin:0 0 14px">Three things worth knowing this week</h1>' +
	'<p style="font-size:17px;line-height:1.6">Everything we shipped, in one place. This is the email your subscribers will receive, rendered by beehiiv with your template, header and footer.</p>' +
	`<p><a id="plain" href="${ ORIGIN }/e2e-link-target" style="color:#c2410c">Read the full story</a></p>` +
	'<script>window.parent.postMessage("e2e-script-ran","*");</script>' +
	'</div>' +
	'<div style="background:#eee;padding:18px 28px;font:13px system-ui,sans-serif;color:#555">You are receiving this because you subscribed to The Acme Weekly. Unsubscribe</div>' +
	'</div></body></html>';

const b64 = ( v ) => Buffer.from( v ).toString( 'base64' );
const arg = ( v ) =>
	`json_decode( base64_decode( "${ b64( JSON.stringify( v ) ) }" ), true )`;
const php = ( code ) =>
	wp.wpCli( `eval 'eval( base64_decode( "${ b64( code ) }" ) );'` );

/**
 * Seeds a connected, ready site with the beehiiv post endpoints mocked.
 *
 * @param {number} emailStatus HTTP status the "fetch email" call returns.
 */
function seed( emailStatus = 200 ) {
	const ok = emailStatus === 200;
	const mocks = {
		create_post: {
			pattern: '#/publications/[^/]+/posts(\\?|$)#',
			method: 'POST',
			status: 201,
			body: { data: { id: DRAFT_ID } },
		},
		update_post: {
			pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
			method: 'PATCH',
			status: 200,
			body: { data: { id: DRAFT_ID } },
		},
		get_email: {
			pattern: '#/publications/[^/]+/posts/[^/?]+\\?#',
			method: 'GET',
			status: emailStatus,
			body: ok
				? {
						data: {
							id: DRAFT_ID,
							content: { free: { email: EMAIL_HTML } },
						},
				  }
				: { message: 'beehiiv is temporarily unavailable' },
		},
	};
	php( `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( ${ arg( { posts: [ 'read', 'write' ] } ) } );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUB }", "name" => "The Acme Weekly" ] ] );
		remove_all_filters( "sanitize_option_beehiiv_settings" );
		update_option( "beehiiv_settings", ${ arg( {
			publication_id: PUB,
			post_template_id: TPL,
		} ) } );
		foreach ( ${ arg(
			mocks
		) } as $key => $mock ) { beehiiv_e2e_mock_http( $key, $mock ); }
		beehiiv_e2e_clear_http_log();
	` );
}

/**
 * Creates a post with "Send to newsletter" on and returns its ID.
 *
 * @param {string} title Post title.
 * @param {Object} meta  Extra post meta.
 * @return {string} The new post ID.
 */
function createPost( title, meta = {} ) {
	return php( `
		$id = wp_insert_post( ${ arg( {
			post_type: 'post',
			post_title: title,
			post_status: 'draft',
			post_author: 1,
			post_content:
				'<!-- wp:paragraph --><p>Everything we shipped, in one place.</p><!-- /wp:paragraph -->',
		} ) } );
		foreach ( ${ arg( {
			_beehiiv_send_to_newsletter: '1',
			...meta,
		} ) } as $k => $v ) { update_post_meta( $id, $k, $v ); }
		echo "ID=" . $id;
	` ).match( /ID=(\d+)/ )[ 1 ];
}

/**
 * Calls the plugin made to beehiiv, as "METHOD name" in order, with bodies.
 *
 * @return {Array} Log entries.
 */
function beehiivCalls() {
	const out = php(
		'echo "JSON=" . wp_json_encode( array_values( (array) get_option( "beehiiv_e2e_http_log", [] ) ) );'
	);
	return JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) ).filter(
		( e ) => e.mock !== '/workspaces/permissions'
	);
}

const labels = ( calls ) => calls.map( ( c ) => `${ c.method } ${ c.mock }` );
const clearLog = () => php( 'beehiiv_e2e_clear_http_log();' );

const previewButton = ( page ) =>
	page.getByRole( 'button', { name: 'Preview email', exact: true } );
const modal = ( page ) => page.getByRole( 'dialog', { name: 'Email preview' } );
const emailFrame = ( page ) => modal( page ).locator( 'iframe' );

/**
 * Closes the preview modal with its Close button, as an editor would.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function closeModal( page ) {
	await glideClick(
		page,
		modal( page ).getByRole( 'button', { name: 'Close' } ).first()
	);
	await expect( modal( page ) ).toHaveCount( 0 );
}

/**
 * Opens a post in the editor with the beehiiv panel visible.
 *
 * @param {import('@playwright/test').Page} page   Page.
 * @param {string}                          postId Post ID.
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
	ids.draft = createPost( 'Acme Weekly: October issue' );
	ids.scheduled = createPost( 'Acme Weekly: September issue', {
		_beehiiv_post_id: LINKED_ID,
		_beehiiv_scheduled_at: new Date( Date.now() + 2 * 86400000 )
			.toISOString()
			.replace( /\.\d{3}Z$/, 'Z' ),
	} );
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
		foreach ( ${ arg( Object.values( ids ) ) } as $id ) {
			delete_post_meta( (int) $id, "_beehiiv_post_id" );
			wp_delete_post( (int) $id, true );
		}
		beehiiv_e2e_reset_all();
		delete_option( "beehiiv_settings" );
	` );
	fs.rmSync( STATE, { force: true } );
} );

test( 'Email preview in the post editor: full walkthrough', async ( {
	page,
	context,
} ) => {
	await installOverlay( page );
	await page.addInitScript( () => {
		window.__e2eMessages = [];
		window.addEventListener( 'message', ( e ) => {
			window.__e2eMessages.push( e.data );
		} );
	} );
	const build = execSync( 'git rev-parse --short HEAD', {
		cwd: path.resolve( __dirname, '../../..' ),
	} )
		.toString()
		.trim();

	// 1. The Preview control ---------------------------------------------------
	await openPanel( page, ids.draft );
	await caption(
		page,
		`Email preview in the post editor · beehiiv plugin build ${ build }`,
		3500
	);
	await caption(
		page,
		'1/4 · A post marked "Send to newsletter". The beehiiv panel has a "Preview email" control (AC-001)',
		1200
	);
	await expect( previewButton( page ) ).toBeEnabled();
	await point( page, previewButton( page ), 4500 );

	// 2. Open the preview -------------------------------------------------------
	await caption( page, 'Click Preview email', 1200 );
	clearLog();
	await glideClick( page, previewButton( page ) );
	await expect( emailFrame( page ) ).toBeVisible( { timeout: 40000 } );
	const frame = page.frameLocator( '.beehiiv-email-preview__modal iframe' );
	await expect( frame.locator( 'h1' ) ).toHaveText(
		'Three things worth knowing this week'
	);
	await caption(
		page,
		'A WordPress modal shows the email as beehiiv rendered it, with template, header and footer (AC-002)',
		6000
	);
	const first = beehiivCalls();
	expect( labels( first ) ).toEqual( [
		'POST create_post',
		'GET get_email',
	] );
	expect( first[ 0 ].body.status ).toBe( 'draft' );
	expect( first[ 0 ].body.title ).toBe( 'Acme Weekly: October issue' );
	await caption(
		page,
		'Behind the scenes: the plugin created a beehiiv draft from the saved post, then fetched its email (AC-003)',
		6000
	);

	// 2b. Desktop and Mobile views ---------------------------------------------------
	const deviceFrame = modal( page ).locator(
		'.beehiiv-email-preview__device'
	);
	const deviceButton = ( name ) =>
		modal( page ).getByRole( 'button', { name, exact: true } );
	await expect( deviceButton( 'Desktop' ) ).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const desktopWidth = ( await deviceFrame.boundingBox() ).width;
	await caption(
		page,
		'The modal also has a Mobile view. Click Mobile',
		1500
	);
	await glideClick( page, deviceButton( 'Mobile' ) );
	await expect( deviceButton( 'Mobile' ) ).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect( deviceFrame ).toHaveClass( /is-mobile/ );
	await expect( frame.locator( 'h1' ) ).toBeVisible();
	const mobileWidth = ( await deviceFrame.boundingBox() ).width;
	expect( mobileWidth ).toBeLessThanOrEqual( 448 );
	expect( mobileWidth ).toBeLessThan( desktopWidth );
	await caption(
		page,
		'Mobile view: the same email in a phone-width frame, so the editor sees how it reads on a phone',
		6500
	);
	await caption( page, 'Switch back to Desktop', 1200 );
	await glideClick( page, deviceButton( 'Desktop' ) );
	await expect( deviceFrame ).toHaveClass( /is-desktop/ );
	await expect( frame.locator( 'h1' ) ).toBeVisible();
	await caption( page, 'Back on the Desktop view', 2000 );

	// 3. The preview is view-only -------------------------------------------------
	const sandbox = await emailFrame( page ).getAttribute( 'sandbox' );
	expect( sandbox ).not.toBeNull();
	expect( sandbox.trim() ).toBe( '' );
	await caption(
		page,
		'2/4 · The email is shown in a sandboxed frame. Scripts are off and links do nothing. Try clicking the link…',
		1500
	);
	await point( page, frame.locator( '#plain' ), 1200 );
	await frame.locator( '#plain' ).click( { force: true, timeout: 5000 } );
	await page.waitForTimeout( 2500 );
	expect( await page.evaluate( () => window.__e2eMessages ) ).toEqual( [] );
	expect( context.pages() ).toHaveLength( 1 );
	await expect( modal( page ) ).toBeVisible();
	await expect( frame.locator( 'h1' ) ).toBeVisible();
	await caption(
		page,
		'Nothing happened: no navigation, no new tab, and the email script did not run (AC-005)',
		5000
	);

	// 4. Edits: unsaved blocks Preview, saving refreshes it --------------------
	await caption( page, '3/4 · Close the preview and edit the title', 1500 );
	await closeModal( page );
	await expect( modal( page ) ).toHaveCount( 0 );
	const title = page
		.frameLocator( 'iframe[name="editor-canvas"]' )
		.locator( '.editor-post-title__input, [aria-label="Add title"]' )
		.first();
	await glideClick( page, title );
	// Put the caret at the end of the title, on any platform.
	await title.evaluate( ( el ) => {
		const range = el.ownerDocument.createRange();
		range.selectNodeContents( el );
		range.collapse( false );
		const selection = el.ownerDocument.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange( range );
	} );
	await page.keyboard.type( ' (final)', { delay: 90 } );
	await expect(
		page.locator( '.beehiiv-post-settings-content' )
	).toContainText( 'Save the post' );
	await expect( previewButton( page ) ).toBeDisabled();
	await point( page, previewButton( page ), 800 );
	await caption(
		page,
		'Preview is disabled until the post is saved. The plugin never saves for the editor (AC-008)',
		5500
	);
	await saveDraft( page );
	await expect( previewButton( page ) ).toBeEnabled( { timeout: 15000 } );
	clearLog();
	await caption( page, 'Save the draft, then preview again', 1500 );
	await glideClick( page, previewButton( page ) );
	await expect( emailFrame( page ) ).toBeVisible( { timeout: 40000 } );
	const second = beehiivCalls();
	expect( labels( second ) ).toEqual( [
		'PATCH update_post',
		'GET get_email',
	] );
	expect( JSON.stringify( second[ 0 ].body ) ).toContain(
		'Acme Weekly: October issue (final)'
	);
	await caption(
		page,
		'Every click re-syncs the saved post first. This time the same beehiiv draft is updated with the new title, not created again (AC-003)',
		6500
	);

	// 5. A failure, then retry in the same modal -----------------------------------
	await closeModal( page );
	await expect( modal( page ) ).toHaveCount( 0 );
	seed( 500 );
	await caption(
		page,
		'When beehiiv fails, the editor sees a clear message instead of a blank modal…',
		1500
	);
	await glideClick( page, previewButton( page ) );
	await expect( modal( page ) ).toContainText(
		'beehiiv is temporarily unavailable',
		{ timeout: 30000 }
	);
	await expect( emailFrame( page ) ).toHaveCount( 0 );
	const retry = modal( page ).getByRole( 'button', { name: 'Try again' } );
	await expect( retry ).toBeVisible();
	await point( page, retry, 800 );
	await caption(
		page,
		'The modal shows beehiiv\'s message and a "Try again" button (AC-013)',
		5000
	);
	seed( 200 );
	await caption( page, 'beehiiv recovers. Click Try again', 1200 );
	await glideClick( page, retry );
	await expect( emailFrame( page ) ).toBeVisible( { timeout: 40000 } );
	await expect( modal( page ) ).not.toContainText(
		'temporarily unavailable'
	);
	await caption(
		page,
		'The preview loads in the same modal, without closing it (AC-015)',
		5000
	);
	await closeModal( page );

	// 6. Already scheduled posts ------------------------------------------------------
	await caption(
		page,
		'4/4 · A post that is already scheduled in beehiiv',
		0
	);
	await openPanel( page, ids.scheduled );
	await expect( previewButton( page ) ).toHaveCount( 0 );
	const reason = page.locator( '.beehiiv-email-preview__reason' );
	await expect( reason ).toContainText( 'already scheduled or sent' );
	await point( page, reason, 800 );
	await caption(
		page,
		"No Preview button. A short reason says this newsletter is already scheduled or sent, so it can't be previewed (AC-010)",
		6000
	);
	await caption( page, 'End of walkthrough', 2500 );
} );
