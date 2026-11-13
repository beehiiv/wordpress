// @demo-acs AC-009 AC-010
/**
 * One-take demo for intake b4c73fce: a WordPress Group block becomes a beehiiv
 * section (Block Conversion Framework, US-006), and a Group inside a Group is
 * left out and marked in the editor while the beehiiv sidebar is open.
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * Every action in the video goes through the real block editor. wp-cli only
 * seeds data and reads back the request the plugin sent to beehiiv, which the
 * tests environment mocks (tests/e2e/plugins/beehiiv-options.php).
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const kit = require( './kit' );

const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUB = 'pub_e2e_demo';
const TPL = 'tpl_e2e_demo';
const STATE = path.join( os.tmpdir(), 'demo-b4c73fce-auth.json' );
const ids = [];

const b64 = ( v ) => Buffer.from( v ).toString( 'base64' );
const arg = ( v ) =>
	`json_decode( base64_decode( "${ b64( JSON.stringify( v ) ) }" ), true )`;
const php = ( code ) =>
	wp.wpCli( `eval 'eval( base64_decode( "${ b64( code ) }" ) );'` );

const para = ( t ) =>
	`<!-- wp:paragraph --><p>${ t }</p><!-- /wp:paragraph -->`;
const head = ( t ) =>
	`<!-- wp:heading --><h2 class="wp-block-heading">${ t }</h2><!-- /wp:heading -->`;
const group = ( inner ) =>
	`<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group">${ inner }</div><!-- /wp:group -->`;

/**
 * Seeds a connected, ready site and an empty request log.
 */
function seed() {
	php( `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( ${ arg( { posts: [ 'read', 'write' ] } ) } );
		update_option( "beehiiv_settings", ${ arg( {
			publication_id: PUB,
			post_template_id: TPL,
		} ) } );
		beehiiv_e2e_seed_publications( ${ arg( [
			{ id: PUB, name: 'Demo Publication' },
		] ) } );
		beehiiv_e2e_seed_post_templates( "${ PUB }", ${ arg( [
			{ id: TPL, name: 'Demo Template' },
		] ) } );
		beehiiv_e2e_mock_http( "/posts", ${ arg( {
			body: { data: { id: 'post_demo' } },
		} ) } );
		beehiiv_e2e_clear_http_log();
	` );
}

/**
 * Creates a draft that will send to the newsletter and returns its ID.
 *
 * @param {string} title   Post title.
 * @param {string} content Block markup.
 * @return {number} Post ID.
 */
function createPost( title, content ) {
	const out = php( `
		$id = wp_insert_post( ${ arg( {
			post_type: 'post',
			post_title: title,
			post_content: content,
			post_status: 'draft',
			post_author: 1,
		} ) } );
		update_post_meta( $id, "_beehiiv_send_to_newsletter", "1" );
		beehiiv_e2e_clear_http_log();
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	ids.push( id );
	return id;
}

/**
 * The blocks the plugin sent to beehiiv in its last create-post request.
 *
 * @return {Array} Blocks array.
 */
function sentBlocks() {
	const out = php( 'beehiiv_e2e_print_http_log();' );
	const log = JSON.parse( out.slice( out.indexOf( '[' ) ) || '[]' );
	const create = log
		.reverse()
		.find(
			( r ) =>
				r.method === 'POST' &&
				/\/publications\/[^/]+\/posts$/.test( r.url )
		);
	expect( create, 'beehiiv create-post request was sent' ).toBeTruthy();
	return create.body.blocks || [];
}

/**
 * Publishes the open post from the editor, as a click on Publish would save it.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function publish( page ) {
	await page.evaluate( async () => {
		await window.wp.data
			.dispatch( 'core/editor' )
			.editPost( { status: 'publish' } );
		await window.wp.data.dispatch( 'core/editor' ).savePost();
	} );
	await page.waitForFunction(
		() =>
			window.wp.data.select( 'core/editor' ).getCurrentPost().status ===
			'publish',
		null,
		{ timeout: 30000 }
	);
}

/**
 * Clicks the beehiiv button in the editor toolbar to open or close its sidebar.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function toggleBeehiivSidebar( page ) {
	await glideClick(
		page,
		page.getByRole( 'button', { name: 'beehiiv', exact: true } ).first()
	);
}

/**
 * Makes sure the beehiiv sidebar is closed, whatever state the editor remembered.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function ensureSidebarClosed( page ) {
	const content = page.locator( '.beehiiv-post-settings-content' );
	const open = await content
		.waitFor( { state: 'visible', timeout: 3000 } )
		.then( () => true )
		.catch( () => false );
	if ( open ) {
		await toggleBeehiivSidebar( page );
	}
	await expect( content ).toBeHidden();
}

test.use( { storageState: STATE, viewport: { width: 1280, height: 720 } } );

test.beforeAll( async ( { browser } ) => {
	wp.ensurePluginActive();
	wp.ensurePrettyPermalinks();
	seed();
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
	` );
	fs.rmSync( STATE, { force: true } );
} );

test( 'Group block to beehiiv section, with the omitted block marked in the beehiiv sidebar', async ( {
	page,
} ) => {
	await installOverlay( page );

	const postId = createPost(
		'Group with a nested Group',
		para( 'Intro paragraph outside the Group.' ) +
			group(
				head( 'Inside the Group' ) +
					para( 'This paragraph goes into the section.' ) +
					group( para( 'This Group sits inside the other Group.' ) )
			)
	);
	await kit.openPostEditor( page, postId );
	const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
	const marked = canvas.locator( '.beehiiv-omitted-block' );

	await caption(
		page,
		'WordPress Group block to beehiiv section · plugin build with the Group change',
		3500
	);
	await caption(
		page,
		'A post with a Group. Inside it: a heading, a paragraph, and another Group',
		1200
	);
	await point( page, canvas.locator( '.wp-block-group' ).first(), 3000 );

	// 1. Sidebar closed ------------------------------------------------------
	await ensureSidebarClosed( page );
	await expect( marked ).toHaveCount( 0 );
	await caption(
		page,
		'The beehiiv panel is closed: the editor canvas shows no marks',
		3500
	);

	// 2. Sidebar open --------------------------------------------------------
	await caption( page, 'Open the beehiiv panel', 1200 );
	await toggleBeehiivSidebar( page );
	await expect(
		page.locator( '.beehiiv-post-settings-notice__omitted' )
	).toContainText( '1 block will be omitted from this newsletter.' );
	await expect( marked ).toHaveCount( 1 );
	await expect(
		canvas.locator(
			'.wp-block-group .wp-block-group.beehiiv-omitted-block'
		)
	).toHaveCount( 1 );
	await point(
		page,
		page.locator( '.beehiiv-post-settings-notice__omitted' ),
		2500
	);
	await caption(
		page,
		'The panel says 1 block will be omitted, and the inner Group shows the hidden-eye icon (AC-010)',
		5000
	);
	await point( page, marked, 2500 );
	await caption(
		page,
		'A beehiiv section cannot hold another section, so the inner Group is left out',
		4500
	);

	// 3. Toggle the panel off and on ----------------------------------------
	await caption( page, 'Close the panel: the marks go away', 1200 );
	await toggleBeehiivSidebar( page );
	await expect( marked ).toHaveCount( 0 );
	await caption( page, 'Marks hidden while the panel is closed', 3000 );
	await caption( page, 'Open it again: the marks come back', 1200 );
	await toggleBeehiivSidebar( page );
	await expect( marked ).toHaveCount( 1 );
	await caption( page, 'Marks are back with the panel open', 3000 );

	// 4. Publish and check what beehiiv received -----------------------------
	await caption(
		page,
		'Publish the post with "Send to newsletter" on',
		1500
	);
	await publish( page );

	const sent = sentBlocks();
	expect( sent.map( ( b ) => b.type ) ).toEqual( [ 'paragraph', 'section' ] );
	const section = sent[ 1 ];
	expect( section.blocks.map( ( b ) => b.type ) ).toEqual( [
		'heading',
		'paragraph',
	] );
	expect( JSON.stringify( sent ) ).not.toContain(
		'This Group sits inside the other Group.'
	);
	await caption(
		page,
		'beehiiv gets one section holding the heading and the paragraph (AC-009)',
		5000
	);
	await caption(
		page,
		'The inner Group is not sent, so the post syncs without an error (AC-010)',
		5000
	);
	await caption(
		page,
		'Group becomes a section. A Group inside a Group is marked, and left out',
		4500
	);
} );
