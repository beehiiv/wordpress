const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/5-post-picker-creation/post-roundup-block.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/PostRoundup.php, PostRoundupSnapshot.php
 * - includes/REST/PostRoundupController.php (`/beehiiv/v1/post-roundup`)
 * - includes/Newsletter/BlockConverter.php, Sender.php
 * - src/js/blocks/post-roundup/ (block `beehiiv/post-roundup`)
 *
 * Sends go through the REST endpoint the block editor uses. Every outbound
 * beehiiv request is answered by the test-only mock in
 * tests/e2e/plugins/beehiiv-options.php and recorded, so specs assert on the
 * exact payload. Nothing reaches the live API.
 */

const TYPE = 'beehiiv_newsletter';
const REST_BASE = 'beehiiv-newsletters';
const META_SEND = '_beehiiv_send_to_newsletter';
const META_POST_ID = '_beehiiv_post_id';
const BLOCK = 'beehiiv/post-roundup';

const PUBLICATION_ID = 'pub_qa_e2e_rr';
const TEMPLATE_ID = 'tpl_qa_e2e_rr';
const MOCK_CREATED_ID = 'post_qa_e2e_rr_created';

const created = [];
let attachmentId = '';
// Regular posts, oldest to newest.
const postIds = {};

const b64 = ( value ) =>
	Buffer.from( JSON.stringify( value ) ).toString( 'base64' );

/**
 * Runs PHP inside the tests env; the payload travels base64-encoded.
 *
 * @param {Object} payload Values exposed to the PHP snippet as `$a`.
 * @param {string} php     PHP code to evaluate.
 * @return {string} wp-cli output.
 */
function wpEvalWith( payload, php ) {
	return wpCli(
		`eval '$a = json_decode( base64_decode( "${ b64(
			payload
		) }" ), true ); ${ php }'`
	);
}

/**
 * Seeds a connected, ready-to-send site and mocks the beehiiv API.
 */
function seed() {
	wpEvalWith(
		{},
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "QA E2E Template" ] ] );
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "${ MOCK_CREATED_ID }" ] ] ] );
		update_option( "timezone_string", "" );
		update_option( "gmt_offset", 0 );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a post of any type directly in the DB.
 *
 * @param {Object} options           Fields.
 * @param {string} options.title     Title.
 * @param {string} [options.status]  Post status.
 * @param {string} [options.type]    Post type.
 * @param {string} [options.content] Post content.
 * @param {string} [options.excerpt] Excerpt.
 * @param {string} [options.date]    Post date (site time).
 * @param {number} [options.thumb]   Featured image attachment ID.
 * @param {Object} [options.meta]    Meta to set.
 * @param {string} [options.pass]    Post password.
 * @return {string} Post ID.
 */
function createItem( {
	title,
	status = 'publish',
	type = 'post',
	content = '<!-- wp:paragraph --><p>QA E2E body.</p><!-- /wp:paragraph -->',
	excerpt = '',
	date = '',
	thumb = 0,
	meta = {},
	pass = '',
} ) {
	const id = wpEvalWith(
		{ title, status, type, content, excerpt, date, thumb, meta, pass },
		`$args = [ "post_type" => $a["type"], "post_title" => $a["title"], "post_status" => $a["status"], "post_content" => $a["content"], "post_excerpt" => $a["excerpt"], "post_author" => 1, "post_password" => $a["pass"] ];
		if ( $a["date"] ) { $args["post_date"] = $a["date"]; $args["post_date_gmt"] = $a["date"]; }
		$id = wp_insert_post( $args );
		if ( $a["thumb"] ) { set_post_thumbnail( $id, (int) $a["thumb"] ); }
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	created.push( id );
	return id;
}

/**
 * Creates a small real image attachment for featured-image cards.
 *
 * @return {string} Attachment ID.
 */
function createAttachment() {
	const id = wpEvalWith(
		{},
		`$png = base64_decode( "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" );
		$up = wp_upload_bits( "qa-e2e-roundup.png", null, $png );
		$att = wp_insert_attachment( [ "post_mime_type" => "image/png", "post_title" => "QA E2E roundup image", "post_status" => "inherit" ], $up["file"] );
		require_once ABSPATH . "wp-admin/includes/image.php";
		wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $up["file"] ) );
		update_post_meta( $att, "_wp_attachment_image_alt", "QA E2E image alt" );
		echo $att . "\\n";`
	);
	created.push( id );
	return id;
}

const roundupBlock = ( attrs ) =>
	`<!-- wp:${ BLOCK } ${ JSON.stringify( attrs ) } /-->`;

function getLog() {
	return JSON.parse(
		wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
}

const creates = ( log ) =>
	log.filter(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);

/**
 * Logs in as admin and returns a REST caller bound to that session.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<Function>} `( method, path, data ) => { status, body }`.
 */
async function restAsAdmin( page ) {
	await loginAsAdmin( page );
	const nonceRes = await page.request.get(
		'/wp-admin/admin-ajax.php?action=rest-nonce'
	);
	const nonce = ( await nonceRes.text() ).trim();
	return async ( method, path, data ) => {
		const res = await page.request.fetch( `/wp-json${ path }`, {
			method,
			headers: { 'X-WP-Nonce': nonce },
			data,
		} );
		let body = null;
		try {
			body = await res.json();
		} catch {
			// Non-JSON response; leave body null.
		}
		return { status: res.status(), body };
	};
}

/**
 * Opens a block editor URL and dismisses the welcome guide.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {string}                          url  Editor URL.
 */
async function openEditor( page, url ) {
	await page.goto( url );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 20000,
	} );
	const close = page.locator( '.components-modal__header button' ).first();
	const appeared = await close
		.waitFor( { state: 'visible', timeout: 4000 } )
		.then( () => true )
		.catch( () => false );
	if ( appeared ) {
		await close.click();
		await close
			.waitFor( { state: 'hidden', timeout: 5000 } )
			.catch( () => {} );
	}
}

/**
 * Opens the block settings sidebar tab.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function openSettingsSidebar( page ) {
	const toggle = page.getByRole( 'button', {
		name: 'Settings',
		exact: true,
	} );
	if ( ( await toggle.getAttribute( 'aria-pressed' ) ) !== 'true' ) {
		await toggle.click();
	}
	const blockTab = page.getByRole( 'tab', { name: 'Block' } );
	if ( await blockTab.isVisible().catch( () => false ) ) {
		await blockTab.click();
	}
}

const titlesOf = ( blocksPayload ) =>
	blocksPayload
		.filter( ( b ) => JSON.stringify( b ).includes( 'QA RR' ) )
		.map( ( b ) => JSON.stringify( b ) );

test.describe.configure( { timeout: 120 * 1000 } );

test.beforeAll( () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
	seed();
	attachmentId = createAttachment();
	// Oldest to newest. Dates are in the past so all are published.
	postIds.p1 = createItem( {
		title: 'QA RR Post One',
		date: '2026-01-01 10:00:00',
		excerpt: 'QA RR excerpt one',
	} );
	postIds.p2 = createItem( {
		title: 'QA RR Post Two',
		date: '2026-01-02 10:00:00',
		excerpt: 'QA RR excerpt two',
		thumb: attachmentId,
	} );
	postIds.p3 = createItem( {
		title: 'QA RR Post Three',
		date: '2026-01-03 10:00:00',
		excerpt: 'QA RR excerpt three',
	} );
	postIds.p4 = createItem( {
		title: 'QA RR Post Four',
		date: '2026-01-04 10:00:00',
		excerpt: 'QA RR excerpt four',
	} );
	// Never eligible: a draft regular post, a published page and a
	// published newsletter.
	postIds.draft = createItem( {
		title: 'QA RR Draft Excluded',
		status: 'draft',
		date: '2026-01-10 10:00:00',
	} );
	postIds.page = createItem( {
		title: 'QA RR Page Excluded',
		type: 'page',
		date: '2026-01-11 10:00:00',
	} );
	postIds.newsletter = createItem( {
		title: 'QA RR Newsletter Excluded',
		type: TYPE,
		date: '2026-01-12 10:00:00',
	} );
} );

test.afterAll( () => {
	if ( created.length ) {
		wpCliSafe(
			`eval 'foreach ( array( ${ created.join(
				', '
			) } ) as $id ) { delete_post_meta( $id, "${ META_POST_ID }" ); wp_delete_post( $id, true ); }'`
		);
	}
	wpCliSafe(
		`eval 'delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: add a roundup of posts to a newsletter', () => {
	test( 'AC-001: the Post Roundup block is available when writing a newsletter and not in regular posts', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );

		const canInsert = () =>
			page.evaluate(
				( name ) => ( {
					type: window.wp.data
						.select( 'core/editor' )
						.getCurrentPostType(),
					insertable: window.wp.data
						.select( 'core/block-editor' )
						.canInsertBlockType( name ),
					inInserter: window.wp.data
						.select( 'core/block-editor' )
						.getInserterItems()
						.some( ( item ) => item.name === name ),
				} ),
				BLOCK
			);

		await openEditor( page, `/wp-admin/post-new.php?post_type=${ TYPE }` );
		const inNewsletter = await canInsert();
		expect( inNewsletter.type ).toBe( TYPE );
		expect( inNewsletter.insertable ).toBe( true );
		expect( inNewsletter.inInserter ).toBe( true );

		for ( const url of [
			'/wp-admin/post-new.php',
			'/wp-admin/post-new.php?post_type=page',
		] ) {
			await openEditor( page, url );
			const result = await canInsert();
			expect( result.insertable ).toBe( false );
			expect( result.inInserter ).toBe( false );
		}
	} );

	test( 'a new newsletter opens with one Post Roundup block that the author can still remove', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await openEditor( page, `/wp-admin/post-new.php?post_type=${ TYPE }` );

		const names = () =>
			page.evaluate( () =>
				window.wp.data
					.select( 'core/block-editor' )
					.getBlocks()
					.map( ( block ) => block.name )
			);

		expect( await names() ).toEqual( [ BLOCK ] );

		const removed = await page.evaluate( () => {
			const { select, dispatch } = window.wp.data;
			const [ block ] = select( 'core/block-editor' ).getBlocks();
			dispatch( 'core/block-editor' ).removeBlock( block.clientId );
			return select( 'core/block-editor' )
				.getBlocks()
				.map( ( item ) => item.name );
		} );
		// The editor adds an empty paragraph to an empty newsletter; the roundup stays gone.
		expect( removed ).not.toContain( BLOCK );
	} );

	test( 'AC-002: automatic mode shows the latest regular posts, newest first, and the author sets how many', async ( {
		page,
	} ) => {
		const rest = await restAsAdmin( page );

		const newsletterId = createItem( {
			title: 'QA RR editor AC-002',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( { mode: 'auto', count: 2, uid: 'ac002' } ),
		} );

		// Server resolver: newest first, any count, never drafts, pages or
		// the newsletter itself.
		const two = await rest(
			'GET',
			`/beehiiv/v1/post-roundup?post_id=${ newsletterId }&mode=auto&count=2&uid=ac002`
		);
		expect( two.status ).toBe( 200 );
		expect( two.body.map( ( c ) => c.title ) ).toEqual( [
			'QA RR Post Four',
			'QA RR Post Three',
		] );
		const four = await rest(
			'GET',
			`/beehiiv/v1/post-roundup?post_id=${ newsletterId }&mode=auto&count=4&uid=ac002`
		);
		const fourTitles = four.body.map( ( c ) => c.title );
		expect( fourTitles ).toEqual( [
			'QA RR Post Four',
			'QA RR Post Three',
			'QA RR Post Two',
			'QA RR Post One',
		] );
		expect( fourTitles.join( '|' ) ).not.toMatch( /Excluded/ );

		// Editor: the block shows two cards, then the author raises the count.
		await openEditor(
			page,
			`/wp-admin/post.php?post=${ newsletterId }&action=edit`
		);
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const cards = canvas.locator( '.beehiiv-post-roundup__card' );
		await expect( cards ).toHaveCount( 2 );
		await expect(
			cards.locator( '.beehiiv-post-roundup__title' )
		).toHaveText( [ 'QA RR Post Four', 'QA RR Post Three' ] );

		await canvas.locator( `[data-type="${ BLOCK }"]` ).click();
		await openSettingsSidebar( page );
		const radio = page.getByRole( 'radio', { name: 'Automatic' } );
		await expect( radio ).toBeChecked();
		const count = page.getByRole( 'spinbutton', {
			name: 'Number of posts',
		} );
		await count.fill( '3' );
		await expect( cards ).toHaveCount( 3 );
		await expect(
			cards.locator( '.beehiiv-post-roundup__title' )
		).toHaveText( [
			'QA RR Post Four',
			'QA RR Post Three',
			'QA RR Post Two',
		] );
	} );

	test( 'AC-003: manual mode lets the author pick posts one by one with a post picker and reorder them', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		const newsletterId = createItem( {
			title: 'QA RR editor AC-003',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( { mode: 'manual', uid: 'ac003' } ),
		} );

		await openEditor(
			page,
			`/wp-admin/post.php?post=${ newsletterId }&action=edit`
		);
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await canvas.locator( `[data-type="${ BLOCK }"]` ).click();
		await openSettingsSidebar( page );
		await expect(
			page.getByRole( 'radio', { name: 'Manual' } )
		).toBeChecked();

		// Pick posts one by one through the picker's search field.
		const picks = [ 'QA RR Post One', 'QA RR Post Three' ];
		for ( const title of picks ) {
			const search = page.locator(
				'.beehiiv-post-roundup__picker input[type="search"]'
			);
			await search.first().click();
			await search.first().fill( title );
			await page
				.locator( '.tenup-content-search-list-item', {
					hasText: title,
				} )
				.first()
				.click();
		}

		const picked = () =>
			page.evaluate( ( name ) => {
				const [ block ] = window.wp.data
					.select( 'core/block-editor' )
					.getBlocks()
					.filter( ( b ) => b.name === name );
				return ( block.attributes.posts || [] ).map( ( p ) =>
					String( p.id )
				);
			}, BLOCK );

		// Both picks are stored. The picker decides where a new pick lands.
		const initial = await picked();
		expect( [ ...initial ].sort() ).toEqual(
			[ postIds.p1, postIds.p3 ].sort()
		);
		const titleOf = ( postId ) =>
			postId === postIds.p1 ? 'QA RR Post One' : 'QA RR Post Three';

		// The picked posts show as cards, in the stored order.
		const titles = canvas.locator(
			'.beehiiv-post-roundup__card .beehiiv-post-roundup__title'
		);
		await expect( titles ).toHaveText( initial.map( titleOf ) );

		// Reorder with the picker's "Move item down" control on the first item.
		// A real mouse click at the control's position: the row around it is a
		// drag target, and a synthetic click would skip its pointer handling.
		const moveDown = page
			.locator( '.beehiiv-post-roundup__picker button', {
				hasText: 'Move item down',
			} )
			.first();
		const box = await moveDown.boundingBox();
		await page.mouse.click( box.x + box.width / 2, box.y + box.height / 2 );

		const swapped = [ initial[ 1 ], initial[ 0 ] ];
		await expect.poll( picked ).toEqual( swapped );
		await expect( titles ).toHaveText( swapped.map( titleOf ) );
	} );

	test( 'AC-004: the editor shows the selected posts inside the block as cards with image, linked title, excerpt and Read more', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		const newsletterId = createItem( {
			title: 'QA RR editor AC-004',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( {
				mode: 'manual',
				uid: 'ac004',
				posts: [
					{ id: Number( postIds.p2 ), type: 'post' },
					{ id: Number( postIds.p1 ), type: 'post' },
				],
			} ),
		} );

		await openEditor(
			page,
			`/wp-admin/post.php?post=${ newsletterId }&action=edit`
		);
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const cards = block.locator( '.beehiiv-post-roundup__card' );
		await expect( cards ).toHaveCount( 2 );

		const first = cards.nth( 0 );
		await expect( first.locator( 'img' ) ).toBeVisible();
		await expect( first.locator( 'img' ) ).toHaveAttribute(
			'alt',
			'QA E2E image alt'
		);
		await expect(
			first.locator( '.beehiiv-post-roundup__title a' )
		).toHaveText( 'QA RR Post Two' );
		await expect(
			first.locator( '.beehiiv-post-roundup__title a' )
		).toHaveAttribute( 'href', /.+/ );
		await expect( first ).toContainText( 'QA RR excerpt two' );
		await expect( first ).toContainText( 'Read more' );

		// Edge case: a post with no featured image shows without an image.
		const second = cards.nth( 1 );
		await expect(
			second.locator( '.beehiiv-post-roundup__title a' )
		).toHaveText( 'QA RR Post One' );
		await expect( second.locator( 'img' ) ).toHaveCount( 0 );
		await expect( second ).toContainText( 'Read more' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: send the roundup to beehiiv', () => {
	test( 'AC-005: sending reaches beehiiv with each post in order, with featured image, linked title, excerpt and a Read more button', async ( {
		page,
	} ) => {
		seed();
		const id = createItem( {
			title: 'QA RR send AC-005',
			type: TYPE,
			status: 'draft',
			content: [
				'<!-- wp:paragraph --><p>RR-INTRO</p><!-- /wp:paragraph -->',
				roundupBlock( {
					mode: 'manual',
					uid: 'ac005',
					posts: [
						{ id: Number( postIds.p2 ), type: 'post' },
						{ id: Number( postIds.p1 ), type: 'post' },
					],
				} ),
				'<!-- wp:paragraph --><p>RR-OUTRO</p><!-- /wp:paragraph -->',
			].join( '\n' ),
			meta: { [ META_SEND ]: '1' },
		} );
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );

		const log = getLog();
		expect( creates( log ) ).toHaveLength( 1 );
		const blocks = creates( log )[ 0 ].body.blocks;
		const json = JSON.stringify( blocks );

		// Intro, then post two, then post one, then outro.
		const order = [
			'RR-INTRO',
			'QA RR Post Two',
			'QA RR Post One',
			'RR-OUTRO',
		].map( ( marker ) => json.indexOf( marker ) );
		order.forEach( ( position ) =>
			expect( position ).toBeGreaterThan( -1 )
		);
		expect( [ ...order ].sort( ( a, b ) => a - b ) ).toEqual( order );

		// Post two: featured image, linked title, excerpt, Read more button.
		expect( json ).toContain( 'qa-e2e-roundup' );
		expect( json.indexOf( 'qa-e2e-roundup' ) ).toBeLessThan( order[ 1 ] );
		expect( json ).toContain( 'QA RR excerpt two' );
		expect( json ).toContain( 'Read more' );

		const types = blocks.map( ( b ) => b.type );
		expect( types ).toContain( 'image' );
		expect( types ).toContain( 'button' );
		// The roundup adds no divider between cards; the template spaces them.
		expect( types ).not.toContain( 'content_break' );

		// Title is a link to the post permalink; excerpt and button follow it.
		const permalinkTwo = wpCli( `post get ${ postIds.p2 } --field=url` );
		const permalinkOne = wpCli( `post get ${ postIds.p1 } --field=url` );
		expect( json ).toContain( permalinkTwo );
		expect( json ).toContain( permalinkOne );
		expect( json.indexOf( 'QA RR excerpt two' ) ).toBeGreaterThan(
			order[ 1 ]
		);
		expect( json.indexOf( 'QA RR excerpt two' ) ).toBeLessThan(
			order[ 2 ]
		);
		const readMoreAt = json.indexOf( 'Read more' );
		expect( readMoreAt ).toBeGreaterThan(
			json.indexOf( 'QA RR excerpt two' )
		);
		expect( readMoreAt ).toBeLessThan( order[ 2 ] );
		// Post one has no featured image, so its section has no image block.
		const oneSection = json.slice( order[ 2 ], order[ 3 ] );
		expect( oneSection ).not.toContain( 'qa-e2e-roundup' );
		expect( oneSection ).toContain( 'QA RR excerpt one' );
		expect( oneSection ).toContain( 'Read more' );
		expect( titlesOf( blocks ).length ).toBeGreaterThan( 0 );
	} );

	test( 'AC-006: in automatic mode the list is fixed when the author sends and matches what the author saw before sending', async ( {
		page,
	} ) => {
		seed();
		const id = createItem( {
			title: 'QA RR send AC-006',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( { mode: 'auto', count: 2, uid: 'ac006' } ),
			meta: { [ META_SEND ]: '1' },
		} );
		const rest = await restAsAdmin( page );

		const previewPath = `/beehiiv/v1/post-roundup?post_id=${ id }&mode=auto&count=2&uid=ac006`;
		const before = await rest( 'GET', previewPath );
		const seenBefore = before.body.map( ( c ) => c.title );
		expect( seenBefore ).toEqual( [
			'QA RR Post Four',
			'QA RR Post Three',
		] );

		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );

		const sent = JSON.stringify( creates( getLog() )[ 0 ].body.blocks );
		// The sent newsletter matches the list the author saw, in order.
		expect( sent.indexOf( 'QA RR Post Four' ) ).toBeGreaterThan( -1 );
		expect( sent.indexOf( 'QA RR Post Three' ) ).toBeGreaterThan(
			sent.indexOf( 'QA RR Post Four' )
		);
		expect( sent ).not.toContain( 'QA RR Post Two' );

		// A newer post is published after the send. The roundup is fixed.
		const later = createItem( {
			title: 'QA RR Published After Send',
			date: '2026-01-20 10:00:00',
		} );
		const after = await rest( 'GET', previewPath );
		expect( after.body.map( ( c ) => c.title ) ).toEqual( seenBefore );

		// A fresh query for the same site state would now differ, proving the
		// list is held rather than re-queried.
		const fresh = await rest(
			'GET',
			`/beehiiv/v1/post-roundup?post_id=${ id }&mode=auto&count=2&uid=other`
		);
		expect( fresh.body[ 0 ].title ).toBe( 'QA RR Published After Send' );

		// A later sync of the same newsletter still sends the frozen list.
		wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
		const update = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			title: 'QA RR send AC-006 edited',
		} );
		expect( update.status ).toBe( 200 );
		const resynced = JSON.stringify( getLog() );
		if ( resynced.includes( 'QA RR Post' ) ) {
			expect( resynced ).toContain( 'QA RR Post Four' );
			expect( resynced ).not.toContain( 'QA RR Published After Send' );
		}
		expect( later ).toBeTruthy();
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: choose and edit what each card shows', () => {
	const attributesOf = ( page ) =>
		page.evaluate( ( name ) => {
			const block = window.wp.data
				.select( 'core/block-editor' )
				.getBlocks()
				.find( ( item ) => item.name === name );
			return block ? block.attributes : null;
		}, BLOCK );

	test( 'AC-008: the author chooses which items cards show, in the editor and in what is sent', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR display AC-008',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( {
				mode: 'manual',
				uid: 'ac008',
				posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
				display: {
					image: false,
					title: true,
					excerpt: false,
					button: true,
				},
			} ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const card = block.locator( '.beehiiv-post-roundup__card' );
		await expect( card ).toHaveCount( 1 );
		await expect( card.locator( 'img' ) ).toHaveCount( 0 );
		await expect(
			card.locator( '.beehiiv-post-roundup__excerpt' )
		).toHaveCount( 0 );
		await expect(
			card.locator( '.beehiiv-post-roundup__title' )
		).toHaveText( 'QA RR Post Two' );
		await expect(
			card.locator( '.beehiiv-post-roundup__button' )
		).toHaveText( 'Read more' );

		// Turning the excerpt and image on shows them in the editor.
		await block.click();
		await openSettingsSidebar( page );
		await page.getByRole( 'checkbox', { name: 'Excerpt' } ).check();
		await page.getByRole( 'checkbox', { name: 'Featured image' } ).check();
		await expect( card.locator( 'img' ) ).toBeVisible();
		await expect(
			card.locator( '.beehiiv-post-roundup__excerpt' )
		).toHaveText( 'QA RR excerpt two' );

		// Turning everything off warns the author.
		for ( const name of [
			'Featured image',
			'Title',
			'Excerpt',
			'Read more',
		] ) {
			await page.getByRole( 'checkbox', { name } ).uncheck();
		}
		await expect(
			page.locator( '.components-notice__content', {
				hasText: 'nothing is sent for this roundup',
			} )
		).toBeVisible();
		expect( ( await attributesOf( page ) ).display ).toMatchObject( {
			image: false,
			title: false,
			excerpt: false,
			button: false,
			author: false,
			date: false,
		} );

		// What is sent follows the stored choices: no image, no excerpt.
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
			content: roundupBlock( {
				mode: 'manual',
				uid: 'ac008',
				posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
				display: {
					image: false,
					title: true,
					excerpt: false,
					button: true,
				},
			} ),
		} );
		expect( res.status ).toBe( 200 );
		const sent = creates( getLog() ).pop().body.blocks;
		const json = JSON.stringify( sent );
		expect( json ).toContain( 'QA RR Post Two' );
		expect( json ).toContain( 'Read more' );
		expect( json ).not.toContain( 'QA RR excerpt two' );
		expect( json ).not.toContain( 'qa-e2e-roundup' );
		expect( sent.map( ( item ) => item.type ) ).toEqual( [
			'paragraph',
			'button',
		] );
	} );

	test( 'AC-009: the author edits a card, resets it, and the edits reach beehiiv without changing the post', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR edit AC-009',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( {
				mode: 'manual',
				uid: 'ac009',
				posts: [ { id: Number( postIds.p1 ), type: 'post' } ],
			} ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const card = canvas.locator( '.beehiiv-post-roundup__card' );
		await expect( card ).toHaveCount( 1 );

		const edit = async ( locator, text ) => {
			await locator.click();
			await page.keyboard.press( 'ControlOrMeta+A' );
			await page.keyboard.type( text );
		};
		await edit(
			card.locator( '.beehiiv-post-roundup__title a' ),
			'RR Edited headline'
		);
		await edit(
			card.locator( '.beehiiv-post-roundup__excerpt' ),
			'RR Edited summary'
		);
		await edit(
			card.locator( '.beehiiv-post-roundup__button' ),
			'RR Keep reading'
		);

		await expect
			.poll( async () => ( await attributesOf( page ) ).overrides )
			.toEqual( {
				[ postIds.p1 ]: {
					title: 'RR Edited headline',
					excerpt: 'RR Edited summary',
					buttonLabel: 'RR Keep reading',
				},
			} );
		const stored = ( await attributesOf( page ) ).overrides;

		// The edits are part of the saved newsletter and survive a reload.
		await page.keyboard.press( 'ControlOrMeta+S' );
		await expect
			.poll( () => wpCli( `post get ${ id } --field=post_content` ) )
			.toContain( 'RR Edited headline' );
		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		await expect(
			canvas.locator( '.beehiiv-post-roundup__title a' )
		).toHaveText( 'RR Edited headline' );

		// Sending carries the edited text; the link is still the post's own.
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );
		const json = JSON.stringify( creates( getLog() ).pop().body.blocks );
		expect( json ).toContain( 'RR Edited headline' );
		expect( json ).toContain( 'RR Edited summary' );
		expect( json ).toContain( 'RR Keep reading' );
		expect( json ).not.toContain( 'QA RR excerpt one' );
		expect( json ).toContain(
			wpCli( `post get ${ postIds.p1 } --field=url` )
		);

		// The source post is unchanged.
		expect( wpCli( `post get ${ postIds.p1 } --field=post_title` ) ).toBe(
			'QA RR Post One'
		);
		expect( wpCli( `post get ${ postIds.p1 } --field=post_excerpt` ) ).toBe(
			'QA RR excerpt one'
		);
		expect( stored ).toBeTruthy();

		// Reset to post restores the post's own values and drops the edits.
		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		await canvas.locator( '.beehiiv-post-roundup__reset' ).click();
		await expect(
			canvas.locator( '.beehiiv-post-roundup__title a' )
		).toHaveText( 'QA RR Post One' );
		await expect(
			canvas.locator( '.beehiiv-post-roundup__button' )
		).toHaveText( 'Read more' );
		expect( ( await attributesOf( page ) ).overrides ).toEqual( {} );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: choose how each card is laid out', () => {
	test( 'AC-010: the author picks a card layout and image placement, in the editor and in what is sent', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const content = ( extra ) =>
			roundupBlock( {
				mode: 'manual',
				uid: 'ac010',
				posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
				...extra,
			} );
		const id = createItem( {
			title: 'QA RR layout AC-010',
			type: TYPE,
			status: 'draft',
			content: content( {} ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const card = block.locator( '.beehiiv-post-roundup__card' );
		const image = card.locator( '.beehiiv-post-roundup__media' );
		const body = card.locator( '.beehiiv-post-roundup__body' );
		await expect( card ).toHaveCount( 1 );

		// Full: the image sits above the text and placement cannot be changed.
		await block.click();
		await openSettingsSidebar( page );
		await expect(
			page.getByRole( 'button', { name: 'Full', exact: true } )
		).toHaveAttribute( 'aria-pressed', 'true' );
		await expect(
			page.getByRole( 'button', { name: 'Right', exact: true } )
		).toBeDisabled();
		const above = {
			image: await image.boundingBox(),
			body: await body.boundingBox(),
		};
		expect( above.image.y ).toBeLessThan( above.body.y );

		// 30:70 with the image on the left.
		await page
			.getByRole( 'button', { name: '30:70', exact: true } )
			.click();
		await expect( card ).toHaveClass( /beehiiv-post-roundup__card--split/ );
		await expect(
			page.getByRole( 'button', { name: 'Right', exact: true } )
		).toBeEnabled();
		let boxes = {
			card: await card.boundingBox(),
			image: await image.boundingBox(),
			body: await body.boundingBox(),
		};
		expect( boxes.image.x ).toBeLessThan( boxes.body.x );
		expect( boxes.image.width / boxes.card.width ).toBeGreaterThan( 0.25 );
		expect( boxes.image.width / boxes.card.width ).toBeLessThan( 0.35 );

		// 70:30 with the image on the right.
		await page
			.getByRole( 'button', { name: '70:30', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Right', exact: true } )
			.click();
		await expect( card ).toHaveClass(
			/beehiiv-post-roundup__card--image-right/
		);
		boxes = {
			card: await card.boundingBox(),
			image: await image.boundingBox(),
			body: await body.boundingBox(),
		};
		expect( boxes.image.x ).toBeGreaterThan( boxes.body.x );
		expect( Math.abs( boxes.image.y - boxes.body.y ) ).toBeLessThan( 4 );
		expect( boxes.image.width / boxes.card.width ).toBeGreaterThan( 0.65 );
		expect( boxes.image.width / boxes.card.width ).toBeLessThan( 0.75 );

		const attrs = await page.evaluate( ( name ) => {
			const found = window.wp.data
				.select( 'core/block-editor' )
				.getBlocks()
				.find( ( item ) => item.name === name );
			return {
				layout: found.attributes.layout,
				imagePlacement: found.attributes.imagePlacement,
			};
		}, BLOCK );
		expect( attrs ).toEqual( { layout: '70-30', imagePlacement: 'right' } );

		// What is sent: two columns, text first, image second, widths 30 and 70.
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
			content: content( { layout: '70-30', imagePlacement: 'right' } ),
		} );
		expect( res.status ).toBe( 200 );
		const sent = creates( getLog() ).pop().body.blocks;
		expect( sent.map( ( item ) => item.type ) ).toEqual( [ 'columns' ] );
		const [ first, second ] = sent[ 0 ].columns;
		expect( first.verticalAlign ).toBe( 'top' );
		expect( second.verticalAlign ).toBe( 'top' );
		expect( first.width ).toBe( 30 );
		expect( first.blocks.map( ( item ) => item.type ) ).toEqual( [
			'paragraph',
			'paragraph',
			'button',
		] );
		expect( second.width ).toBe( 70 );
		expect( second.blocks.map( ( item ) => item.type ) ).toEqual( [
			'image',
		] );
		expect( JSON.stringify( second ) ).toContain( 'qa-e2e-roundup' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'Roundup inside other blocks', () => {
	const inColumn = ( extra = {} ) =>
		`<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column">${ roundupBlock(
			{
				mode: 'manual',
				uid: 'nested1',
				posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
				...extra,
			}
		) }</div><!-- /wp:column --><!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p>RR-BESIDE</p><!-- /wp:paragraph --></div><!-- /wp:column --></div><!-- /wp:columns -->`;

	test( 'a roundup inside a Columns block shows its cards and does not error', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR nested editor',
			type: TYPE,
			status: 'draft',
			content: inColumn(),
		} );

		const errors = [];
		page.on( 'pageerror', ( error ) => errors.push( error.message ) );
		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await expect(
			canvas.locator( '.beehiiv-post-roundup__card' )
		).toHaveCount( 1 );
		await expect(
			canvas.getByText( 'This block has encountered an error' )
		).toHaveCount( 0 );

		// The author is told cards are full width inside a column.
		await canvas.locator( `[data-type="${ BLOCK }"]` ).click();
		await openSettingsSidebar( page );
		await expect(
			page.locator( '.components-notice__content', {
				hasText: 'cards are sent full width',
			} )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: '30:70', exact: true } )
		).toBeDisabled();
		expect( errors ).toEqual( [] );
	} );

	test( 'a roundup inside a Columns block and a Group block is sent to beehiiv', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR nested send',
			type: TYPE,
			status: 'draft',
			content: [
				// A split layout is sent full width inside a column.
				inColumn( { layout: '30-70' } ),
				`<!-- wp:group --><div class="wp-block-group">${ roundupBlock( {
					mode: 'manual',
					uid: 'nested2',
					posts: [ { id: Number( postIds.p1 ), type: 'post' } ],
				} ) }</div><!-- /wp:group -->`,
			].join( '\n' ),
			meta: { [ META_SEND ]: '1' },
		} );
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );

		const sent = creates( getLog() ).pop().body.blocks;
		const columns = sent.find( ( item ) => item.type === 'columns' );
		expect( columns ).toBeTruthy();

		// The roundup is in the first column, full width: image, title, excerpt, button.
		const first = JSON.stringify( columns.columns[ 0 ] );
		expect( first ).toContain( 'QA RR Post Two' );
		expect( first ).toContain( 'QA RR excerpt two' );
		expect( first ).toContain( 'Read more' );
		expect(
			columns.columns[ 0 ].blocks.map( ( item ) => item.type )
		).toEqual( [ 'image', 'paragraph', 'paragraph', 'button' ] );
		expect( JSON.stringify( columns.columns[ 1 ] ) ).toContain(
			'RR-BESIDE'
		);

		// The roundup in the Group is inside the beehiiv section.
		const section = sent.find( ( item ) => item.type === 'section' );
		expect( section ).toBeTruthy();
		expect( JSON.stringify( section ) ).toContain( 'QA RR Post One' );
		expect( JSON.stringify( section ) ).toContain( 'QA RR excerpt one' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-005: columns, author, date and image captions', () => {
	const attributesOf = ( page ) =>
		page.evaluate( ( name ) => {
			const found = window.wp.data
				.select( 'core/block-editor' )
				.getBlocks()
				.find( ( item ) => item.name === name );
			return found ? found.attributes : null;
		}, BLOCK );

	const manual = ( extra = {} ) => ( {
		mode: 'manual',
		uid: 'us005',
		posts: [
			{ id: Number( postIds.p4 ), type: 'post' },
			{ id: Number( postIds.p3 ), type: 'post' },
			{ id: Number( postIds.p2 ), type: 'post' },
		],
		...extra,
	} );

	const publishWith = async ( page, id, attrs ) => {
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
			content: roundupBlock( attrs ),
		} );
		expect( res.status ).toBe( 200 );
		return creates( getLog() ).pop().body.blocks;
	};

	test( 'AC-011: the author puts cards in 1, 2 or 3 columns, in the editor and in what is sent', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR columns AC-011',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( manual() ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const cards = block.locator( '.beehiiv-post-roundup__card' );
		await expect( cards ).toHaveCount( 3 );
		await block.click();
		await openSettingsSidebar( page );

		const columnButton = ( name ) =>
			page
				.locator( '.beehiiv-post-roundup__options', {
					hasText: 'Columns',
				} )
				.getByRole( 'button', { name, exact: true } );

		// One column: cards stack.
		const first = await cards.nth( 0 ).boundingBox();
		const second = await cards.nth( 1 ).boundingBox();
		expect( second.y ).toBeGreaterThan( first.y );

		// Two columns: the first two cards share a row, and the ratio is locked.
		await columnButton( '2' ).click();
		await expect(
			block.locator( '.beehiiv-post-roundup__row' )
		).toHaveCount( 2 );
		const rowOne = [
			await cards.nth( 0 ).boundingBox(),
			await cards.nth( 1 ).boundingBox(),
		];
		expect( Math.abs( rowOne[ 0 ].y - rowOne[ 1 ].y ) ).toBeLessThan( 4 );
		expect( rowOne[ 1 ].x ).toBeGreaterThan( rowOne[ 0 ].x );
		await expect(
			page.getByRole( 'button', { name: '30:70', exact: true } )
		).toBeEnabled();

		// Cards with the image beside the text sit alone in their row, so the
		// columns setting is turned off while a ratio is chosen.
		await page
			.getByRole( 'button', { name: '30:70', exact: true } )
			.click();
		await expect(
			block.locator( '.beehiiv-post-roundup__row' )
		).toHaveCount( 3 );
		await expect( columnButton( '3' ) ).toBeDisabled();
		await page.getByRole( 'button', { name: 'Full', exact: true } ).click();
		await expect( columnButton( '3' ) ).toBeEnabled();

		// Three columns: all three share one row.
		await columnButton( '3' ).click();
		await expect(
			block.locator( '.beehiiv-post-roundup__row' )
		).toHaveCount( 1 );
		expect( ( await attributesOf( page ) ).columns ).toBe( 3 );

		// What is sent: columns blocks with equal widths, text under each image.
		const three = await publishWith( page, id, manual( { columns: 3 } ) );
		expect( three.map( ( item ) => item.type ) ).toEqual( [ 'columns' ] );
		expect( three[ 0 ].columns.map( ( c ) => c.width ) ).toEqual( [
			33, 33, 34,
		] );
		expect( JSON.stringify( three[ 0 ].columns[ 0 ] ) ).toContain(
			'QA RR Post Four'
		);
		expect( JSON.stringify( three[ 0 ].columns[ 2 ] ) ).toContain(
			'QA RR Post Two'
		);
		expect(
			three[ 0 ].columns[ 2 ].blocks.map( ( item ) => item.type )
		).toEqual( [ 'image', 'paragraph', 'paragraph', 'button' ] );
	} );

	test( 'AC-008 and AC-009: the author shows and edits the post author and date', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR meta AC-012',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( manual() ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const card = block.locator( '.beehiiv-post-roundup__card' ).first();
		await expect( card ).toBeVisible();

		// Both are off to begin with.
		await expect(
			card.locator( '.beehiiv-post-roundup__meta' )
		).toHaveCount( 0 );
		await block.click();
		await openSettingsSidebar( page );
		await page.getByRole( 'checkbox', { name: 'Author' } ).check();
		await page.getByRole( 'checkbox', { name: 'Date' } ).check();
		const meta = card.locator( '.beehiiv-post-roundup__meta' );
		await expect( meta ).toContainText( 'By admin' );
		await expect( meta ).toContainText( '2026' );

		// The author can edit the author name for this newsletter.
		const authorField = card.locator( '.beehiiv-post-roundup__author' );
		await authorField.click();
		await page.keyboard.press( 'ControlOrMeta+A' );
		await page.keyboard.type( 'The Editors' );
		await expect( meta ).toContainText( 'By The Editors' );
		await expect
			.poll( async () => ( await attributesOf( page ) ).overrides )
			.toEqual( {
				[ postIds.p4 ]: { author: 'The Editors' },
			} );

		// What is sent: one line under the title, with the edited name.
		const sent = await publishWith(
			page,
			id,
			manual( {
				display: { author: true, date: true },
				overrides: { [ postIds.p4 ]: { author: 'The Editors' } },
			} )
		);
		const lines = sent
			.filter( ( item ) => item.type === 'paragraph' && item.plaintext )
			.map( ( item ) => item.plaintext );
		expect(
			lines.some( ( line ) => /^By The Editors · .*2026/.test( line ) )
		).toBe( true );
		expect(
			lines.some( ( line ) => /^By admin · .*2026/.test( line ) )
		).toBe( true );
		expect( wpCli( `user get 1 --field=display_name` ) ).toBe( 'admin' );
	} );

	test( 'AC-013: the author adds a caption to the image, and it is sent with the image', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const id = createItem( {
			title: 'QA RR caption AC-013',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( {
				mode: 'manual',
				uid: 'us005c',
				posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
			} ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const card = canvas.locator( '.beehiiv-post-roundup__card' ).first();
		await expect( card.locator( 'img' ) ).toBeVisible();

		const caption = card.locator( '.beehiiv-post-roundup__caption' );
		await caption.click();
		await page.keyboard.type( 'Photo: a quiet morning' );
		await expect( caption ).toHaveText( 'Photo: a quiet morning' );
		await expect
			.poll( async () => ( await attributesOf( page ) ).overrides )
			.toEqual( {
				[ postIds.p2 ]: { caption: 'Photo: a quiet morning' },
			} );

		const sent = await publishWith( page, id, {
			mode: 'manual',
			uid: 'us005c',
			posts: [ { id: Number( postIds.p2 ), type: 'post' } ],
			overrides: {
				[ postIds.p2 ]: { caption: 'Photo: a quiet morning' },
			},
		} );
		const image = sent.find( ( item ) => item.type === 'image' );
		expect( image.caption ).toBe( 'Photo: a quiet morning' );

		// The caption stays with the newsletter: the post's image is unchanged.
		expect(
			wpCli(
				`eval 'echo wp_get_attachment_caption( get_post_thumbnail_id( ${ postIds.p2 } ) );'`
			)
		).toBe( '' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-006: Read more as a button or a text link', () => {
	test( 'AC-012: the author chooses a button or a text link for Read more, in the editor and in what is sent', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		seed();
		const attrs = ( extra = {} ) => ( {
			mode: 'manual',
			uid: 'us006',
			posts: [ { id: Number( postIds.p1 ), type: 'post' } ],
			...extra,
		} );
		const id = createItem( {
			title: 'QA RR cta AC-012',
			type: TYPE,
			status: 'draft',
			content: roundupBlock( attrs() ),
			meta: { [ META_SEND ]: '1' },
		} );

		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const block = canvas.locator( `[data-type="${ BLOCK }"]` );
		const card = block.locator( '.beehiiv-post-roundup__card' ).first();
		await expect(
			card.locator( '.beehiiv-post-roundup__button' )
		).toHaveText( 'Read more' );

		// A text link instead of a button.
		await block.click();
		await openSettingsSidebar( page );
		await page
			.locator( '.beehiiv-post-roundup__options', {
				hasText: 'Read more style',
			} )
			.getByRole( 'button', { name: 'Link', exact: true } )
			.click();
		await expect(
			card.locator( '.beehiiv-post-roundup__button' )
		).toHaveCount( 0 );
		const link = card.locator( '.beehiiv-post-roundup__cta-link' );
		await expect( link ).toHaveText( 'Read more' );

		// The label is still editable, whichever style is chosen.
		await link.click();
		await page.keyboard.press( 'ControlOrMeta+A' );
		await page.keyboard.type( 'Read here' );
		await expect( link ).toHaveText( 'Read here' );

		// What is sent: a linked line of text, no button block.
		const rest = await restAsAdmin( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
			content: roundupBlock(
				attrs( {
					ctaStyle: 'link',
					overrides: { [ postIds.p1 ]: { buttonLabel: 'Read here' } },
				} )
			),
		} );
		expect( res.status ).toBe( 200 );
		const sent = creates( getLog() ).pop().body.blocks;
		expect( sent.map( ( item ) => item.type ) ).toEqual( [
			'paragraph',
			'paragraph',
			'paragraph',
		] );
		const last = sent[ sent.length - 1 ];
		expect( last.formattedText[ 0 ].text ).toBe( 'Read here' );
		expect( last.formattedText[ 0 ].link.href ).toBe(
			wpCli( `post get ${ postIds.p1 } --field=url` )
		);
	} );
} );
