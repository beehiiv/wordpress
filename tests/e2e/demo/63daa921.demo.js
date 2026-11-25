// @demo-acs AC-050 AC-051 AC-054
/**
 * One-take demo for intake 63daa921: keep the beehiiv template header when a
 * post is updated from WordPress (PRD-07.1.01, US-013).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with the tests-environment seams the QA spec uses
 * (tests/e2e/plugins/beehiiv-options.php). Every edit and every Update click
 * goes through the real block editor. beehiiv's servers are never called: the
 * plugin's outgoing request is captured by the test mock, and wp-cli reads that
 * request log back so each caption is backed by an assertion on the real
 * request. The request panel shown on screen is drawn from that log.
 */
const path = require( 'path' );
const os = require( 'os' );
const kit = require( './kit' );
const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUBLICATION_ID = 'pub_demo_63daa921';
const TEMPLATE_ID = 'tpl_demo_63daa921';
const LINKED_ID = 'post_demo_63daa921';
const TEMPLATE_META = '_beehiiv_linked_post_template_id';
const STATE = path.join( os.tmpdir(), 'demo-63daa921-auth.json' );
const ids = [];

const php = ( code ) =>
	wp.wpCli(
		`eval 'eval( base64_decode( "${ Buffer.from( code ).toString(
			'base64'
		) }" ) );'`
	);

function seed() {
	php( `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( array( "posts" => array( "read", "write" ) ) );
		update_option( "beehiiv_settings", array( "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ) );
		beehiiv_e2e_seed_publications( array( array( "id" => "${ PUBLICATION_ID }", "name" => "Demo Publication" ) ) );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", array( array( "id" => "${ TEMPLATE_ID }", "name" => "Demo Template" ) ) );
		beehiiv_e2e_mock_http( "/posts", array( "body" => array( "data" => array( "id" => "${ LINKED_ID }" ) ) ) );
		beehiiv_e2e_clear_http_log();
	` );
}

function createLinkedPost( title, withTemplate ) {
	const body =
		'<!-- wp:paragraph --><p>This paragraph is the newsletter body before the edit.</p><!-- /wp:paragraph -->';
	const out = php( `
		$id = wp_insert_post( wp_slash( array(
			"post_type" => "post",
			"post_title" => ${ JSON.stringify( title ) },
			"post_status" => "publish",
			"post_content" => ${ JSON.stringify( body ) },
			"post_author" => 1,
		) ) );
		update_post_meta( $id, "_beehiiv_post_id", "${ LINKED_ID }" );
		update_post_meta( $id, "_beehiiv_send_to_newsletter", "" );
		${
			withTemplate
				? `update_post_meta( $id, "${ TEMPLATE_META }", "${ TEMPLATE_ID }" );`
				: ''
		}
		beehiiv_e2e_clear_http_log();
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	ids.push( id );
	return id;
}

function updateRequests() {
	const log = JSON.parse(
		wp.wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
	return log.filter( ( r ) => r.method === 'PATCH' );
}

function clearLog() {
	wp.wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
}

async function dismissGuide( page ) {
	const close = page.locator( '.components-modal__header button' ).first();
	if ( await close.isVisible().catch( () => false ) ) {
		await close.click();
	}
}

/**
 * Draws the captured request on screen, so a viewer sees what was sent.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          heading
 * @param {Array<string>}                   lines
 */
async function showRequest( page, heading, lines ) {
	await page.evaluate(
		( { h, l } ) => {
			let box = document.getElementById( '__demo_request' );
			if ( ! box ) {
				box = document.createElement( 'div' );
				box.id = '__demo_request';
				box.style.cssText =
					'position:fixed;right:24px;top:70px;width:470px;padding:16px 18px;border-radius:10px;background:#0f172a;color:#e2e8f0;font:13px/1.5 ui-monospace,Menlo,monospace;z-index:2147483646;box-shadow:0 8px 30px rgba(0,0,0,.45);white-space:pre-wrap';
				document.documentElement.append( box );
			}
			box.textContent = h + '\n\n' + l.join( '\n' );
			box.style.display = 'block';
		},
		{ h: heading, l: lines }
	);
}

async function hideRequest( page ) {
	await page.evaluate( () => {
		const box = document.getElementById( '__demo_request' );
		if ( box ) {
			box.style.display = 'none';
		}
	} );
}

async function editAndUpdate( page, text ) {
	const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
	const paragraph = canvas.locator( 'p.wp-block-paragraph, p' ).first();
	await glideClick( page, paragraph );
	await page.keyboard.press( 'End' );
	await page.keyboard.type( ` ${ text }`, { delay: 60 } );
	await page.waitForTimeout( 800 );
	const update = page.getByRole( 'button', {
		name: /^(Update|Save)$/,
	} );
	const saved = page.waitForResponse(
		( res ) =>
			res.url().includes( '/wp/v2/posts/' ) &&
			res.request().method() !== 'GET' &&
			res.ok()
	);
	await glideClick( page, update );
	await saved;
	await page.waitForTimeout( 2500 );
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
		beehiiv_e2e_reset_all();
		foreach ( array_filter( explode( ",", "${ ids.join(
			','
		) }" ) ) as $id ) { wp_delete_post( (int) $id, true ); }
		delete_option( "beehiiv_settings" );
	` );
} );

test( 'Updating a post from WordPress keeps the beehiiv template header', async ( {
	page,
} ) => {
	const templated = createLinkedPost(
		'Demo: weekly note (from a template)',
		true
	);
	const plain = createLinkedPost( 'Demo: older post (no template)', false );

	await installOverlay( page );

	// Scene 1: a post that was created from a beehiiv template (AC-050).
	await kit.openPostEditor( page, templated );
	await dismissGuide( page );
	await caption(
		page,
		'This post was created from a beehiiv template, so beehiiv holds a header for it. We edit the body and save it.',
		3500
	);
	clearLog();
	await editAndUpdate( page, 'Edited from WordPress.' );
	let patches = updateRequests();
	expect( patches ).toHaveLength( 1 );
	expect( patches[ 0 ].body.content_merge_strategy ).toBe(
		'append_to_template'
	);
	expect( JSON.stringify( patches[ 0 ].body.blocks ) ).toContain(
		'Edited from WordPress.'
	);
	await showRequest( page, 'Request the plugin sent to beehiiv', [
		'method: PATCH (update the post)',
		'content_merge_strategy: ' + patches[ 0 ].body.content_merge_strategy,
		'blocks: your edited text is in the body',
	] );
	await caption(
		page,
		'The update asks beehiiv to append the new blocks to the template, so the header stays. The edited text is in the blocks sent.',
		5500
	);
	await hideRequest( page );

	// Scene 2: a post with no template keeps today's request (AC-051).
	await kit.openPostEditor( page, plain );
	await dismissGuide( page );
	await caption(
		page,
		'This older post has no template. We edit it and save it the same way.',
		3500
	);
	clearLog();
	await editAndUpdate( page, 'Edited from WordPress.' );
	patches = updateRequests();
	expect( patches ).toHaveLength( 1 );
	expect( patches[ 0 ].body ).not.toHaveProperty( 'content_merge_strategy' );
	expect( Array.isArray( patches[ 0 ].body.blocks ) ).toBe( true );
	await showRequest( page, 'Request the plugin sent to beehiiv', [
		'method: PATCH (update the post)',
		'content_merge_strategy: not sent',
		'blocks: your edited text is in the body',
	] );
	await caption(
		page,
		'Without a template the request is the same as before: no merge setting, just the blocks.',
		5500
	);
	await hideRequest( page );

	// Scene 3: there is no setting for this (AC-054).
	await page.goto( '/wp-admin/admin.php?page=beehiiv' );
	await expect( page.locator( '#wpbody-content' ) ).toBeVisible();
	await expect(
		page
			.locator( '#wpbody-content' )
			.getByText(
				/merge strategy|replace the (whole )?body|template header/i
			)
	).toHaveCount( 0 );
	await point( page, page.locator( '#wpbody-content' ), 800 );
	await caption(
		page,
		'The beehiiv settings page has no option for this. Posts from a template always keep their header.',
		5000
	);
	await caption( page, '', 0 );
} );
