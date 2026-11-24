// @demo-acs AC-001 AC-002 AC-003 AC-009 AC-013 AC-014 AC-015 AC-016 AC-017 AC-018 AC-019 AC-022
/**
 * One-take demo for intake 251e59b4: Custom HTML blocks sent to beehiiv as
 * HTML Snippets, with a per-block "Newsletter only" option (PRD-07.2.02).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with wp-cli and the plugin's test-only beehiiv mock, so
 * nothing reaches the live API. The editor steps go through the real UI. The
 * post is published through the same REST endpoint the editor uses, and every
 * caption about the site, the feed or the beehiiv payload follows an assertion.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const kit = require( './kit' );
const { saveDraft } = require( '../utils/editor' );
const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUBLICATION_ID = 'pub_demo_html';
const TEMPLATE_ID = 'tpl_demo_html';
const CREATED_ID = 'post_demo_html_created';
const STATE = path.join( os.tmpdir(), 'demo-251e59b4-auth.json' );
const NEWSLETTER_ONLY_BLOCK = '[data-type="core/html"].beehiiv-newsletter-only';
const ids = [];

const b64 = ( value ) =>
	Buffer.from( JSON.stringify( value ) ).toString( 'base64' );

const evalWith = ( payload, php ) =>
	wp.wpCli(
		`eval '$a = json_decode( base64_decode( "${ b64(
			payload
		) }" ), true ); ${ php }'`
	);

const p = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const html = ( source ) => `<!-- wp:html -->\n${ source }\n<!-- /wp:html -->`;

const VISIBLE =
	'<div style="border:1px solid #ccc;padding:8px">Spring offer for readers</div>\n<table><tr><td>Offer details</td></tr></table>';
const LINKED_IMAGE =
	'<a href="https://example.com/sponsor?utm_source=demo"><img src="https://example.com/banner.png" alt="Sponsor banner"></a>';
const PIXEL =
	'<img src="https://example.com/pixel.gif?id=demo-track" width="1" height="1" alt="">';
const SCRIPT = '<script>window.demo = true;</script>';
const AD_SOURCE = `${ LINKED_IMAGE }\n${ PIXEL }\n${ SCRIPT }`;
const AD_SENT = `${ LINKED_IMAGE }\n${ PIXEL }`;

function seed() {
	evalWith(
		{},
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "Demo Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "Demo Template" ] ] );
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "${ CREATED_ID }" ] ] ] );
		beehiiv_e2e_clear_http_log();`
	);
}

function createPost() {
	const post = {
		post_type: 'post',
		post_title: 'Spring newsletter',
		post_content:
			p( 'Welcome to this week’s issue.' ) +
			html( VISIBLE ) +
			p( 'More news below.' ) +
			html( AD_SOURCE ),
		post_status: 'draft',
		post_author: 1,
	};
	const id = evalWith(
		{ post },
		`wp_set_current_user( 1 );
		$id = wp_insert_post( $a["post"] );
		update_post_meta( $id, "_beehiiv_send_to_newsletter", "1" );
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	ids.push( id );
	return id;
}

async function dismissGuide( page ) {
	const close = page.locator( '.components-modal__header button' ).first();
	if ( await close.isVisible().catch( () => false ) ) {
		await close.click();
	}
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
	wp.wpCliSafe(
		`eval 'beehiiv_e2e_reset_all(); foreach ( array( ${
			ids.join( ', ' ) || '0'
		} ) as $id ) { wp_delete_post( $id, true ); } delete_option( "beehiiv_settings" );'`
	);
	fs.rmSync( STATE, { force: true } );
} );

test( 'Custom HTML to beehiiv: full walkthrough', async ( { page } ) => {
	await installOverlay( page );
	const id = createPost();

	// 1. Editor: a post with two Custom HTML blocks -----------------------
	await page.goto( `/wp-admin/post.php?post=${ id }&action=edit` );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 20000,
	} );
	await dismissGuide( page );
	const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
	const blocks = canvas.locator( '[data-type="core/html"]' );
	await expect( blocks ).toHaveCount( 2 );
	await caption(
		page,
		'Custom HTML to beehiiv · demo of the beehiiv plugin build',
		3000
	);
	await caption(
		page,
		'1/4 · The post has a paragraph, a Custom HTML block, a paragraph and a second Custom HTML block',
		3500
	);
	await point( page, blocks.nth( 1 ), 800 );
	await caption(
		page,
		'The second block is advertiser HTML: a linked image, a tracking pixel and a script',
		4000
	);

	// 2. The Newsletter only option -----------------------------------------
	await glideClick( page, blocks.nth( 1 ) );
	await page.evaluate( () => {
		const store = window.wp.data.select( 'core/block-editor' );
		const found = store
			.getBlocks()
			.filter( ( b ) => b.name === 'core/html' );
		window.wp.data
			.dispatch( 'core/block-editor' )
			.selectBlock( found[ 1 ].clientId );
	} );
	const toggle = page.getByRole( 'checkbox', { name: 'Newsletter only' } );
	const settingsButton = page
		.getByRole( 'button', { name: 'Settings', exact: true } )
		.first();
	if ( ( await settingsButton.getAttribute( 'aria-pressed' ) ) !== 'true' ) {
		await settingsButton.click();
	}
	const blockTab = page.getByRole( 'tab', { name: 'Block', exact: true } );
	if ( await blockTab.isVisible().catch( () => false ) ) {
		await blockTab.click();
	}
	const innerTab = page.getByRole( 'tab', { name: 'Settings', exact: true } );
	if ( await innerTab.isVisible().catch( () => false ) ) {
		await innerTab.click();
	}
	await expect( toggle ).toBeVisible();
	await expect( toggle ).not.toBeChecked();
	await caption(
		page,
		'2/4 · The block settings have a "Newsletter only" option, off by default (AC-013)',
		4000
	);
	await glideClick( page, toggle );
	await expect( toggle ).toBeChecked();
	// One block carries the class that draws the label, so only that block is labelled.
	const label = canvas.locator( NEWSLETTER_ONLY_BLOCK );
	await expect( label ).toHaveCount( 1 );
	await point( page, label, 800 );
	await caption(
		page,
		'Turned on for this block only. It is labelled in the editor, and only this block is labelled (AC-018, AC-019)',
		4500
	);
	await saveDraft( page );
	await caption( page, 'Saved', 1200 );

	// 3. Publish and look at the site and the feed -------------------------
	await caption(
		page,
		'3/4 · Publish the post. The site and the feed show only the first Custom HTML block',
		3000
	);
	const nonce = (
		await (
			await page.request.get(
				'/wp-admin/admin-ajax.php?action=rest-nonce'
			)
		).text()
	).trim();
	const res = await page.request.fetch( `/wp-json/wp/v2/posts/${ id }`, {
		method: 'POST',
		headers: { 'X-WP-Nonce': nonce },
		data: { status: 'publish' },
	} );
	expect( res.status() ).toBe( 200 );
	const post = await res.json();
	const front = await ( await page.request.get( post.link ) ).text();
	const feed = await ( await page.request.get( '/?feed=rss2' ) ).text();
	const rendered = await (
		await page.request.get( `/wp-json/wp/v2/posts/${ id }` )
	).json();
	for ( const channel of [
		front,
		feed,
		rendered.content.rendered,
		rendered.excerpt.rendered,
	] ) {
		expect( channel ).not.toContain( 'utm_source=demo' );
		expect( channel ).not.toContain( 'demo-track' );
		expect( channel ).not.toContain( 'Sponsor banner' );
	}
	expect( front ).toContain( 'Spring offer for readers' );
	expect( front ).toContain( 'Offer details' );
	expect( feed ).toContain( 'Spring offer for readers' );
	await page.goto( post.link );
	await expect( page.getByText( 'Spring offer for readers' ) ).toBeVisible();
	await caption(
		page,
		'Front end: the first Custom HTML block shows. The sponsor block is not on the page (AC-014, AC-016)',
		4500
	);
	await page.goto( '/?feed=rss2' );
	await caption(
		page,
		'RSS feed: same result. The sponsor block is also missing from the excerpt and the REST content (AC-017)',
		4500
	);

	// 4. What beehiiv received ----------------------------------------------
	const log = JSON.parse(
		wp.wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
	const created = log.filter(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);
	expect( created ).toHaveLength( 1 );
	const sent = created[ 0 ].body.blocks || [];
	expect( sent.map( ( b ) => b.type ) ).toEqual( [
		'paragraph',
		'html',
		'paragraph',
		'html',
	] );
	const snippets = sent.filter( ( b ) => b.type === 'html' );
	expect( snippets.map( ( b ) => b.html ) ).toEqual( [ VISIBLE, AD_SENT ] );
	expect( snippets[ 1 ].html ).not.toContain( '<script' );
	await page.goto( `/wp-admin/post.php?post=${ id }&action=edit` );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 20000,
	} );
	await dismissGuide( page );
	await caption(
		page,
		'4/4 · What beehiiv received: paragraph, HTML snippet, paragraph, HTML snippet, in the same order (AC-001, AC-003, AC-015)',
		5000
	);
	await caption(
		page,
		'The HTML arrived as written: styles, table, linked image and tracking pixel. Only the script was removed (AC-002, AC-009, AC-022)',
		5500
	);
	await caption( page, '', 0 );
} );
