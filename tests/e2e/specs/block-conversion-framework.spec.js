const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { openPostEditor } = require( '../utils/editor' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/2-block-conversion/block-conversion-framework.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/BlockConverter.php -- block routing, Group to section.
 * - includes/Newsletter/SupportedBlocks.php -- supported block registry.
 * - includes/Newsletter/PostSettingsBuilder.php -- Group gate (first sync marker).
 * - includes/Newsletter/Sender.php -- sets the first-sync marker on create.
 * - includes/Editor/Meta.php -- post meta keys.
 *
 * Every save goes through the REST endpoint the block editor uses
 * (POST /wp/v2/posts/{id}, cookie + nonce), which fires the newsletter sync.
 * Every outbound beehiiv request is answered by the test-only
 * `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php and
 * recorded in its request log, so specs assert on the exact `blocks` payload
 * the plugin sent to beehiiv. Nothing reaches the live API.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	snippet: '_beehiiv_send_to_newsletter_snippet',
	postId: '_beehiiv_post_id',
	groupSections: '_beehiiv_group_sections',
};

const PUBLICATION_ID = 'pub_qa_e2e_blocks';
const TEMPLATE_ID = 'tpl_qa_e2e_blocks';
const MOCK_CREATED_ID = 'post_qa_e2e_blocks_created';
const LEGACY_ID = 'post_qa_e2e_blocks_legacy';
const ACTIVE_AD = 'ad_qa_active';
const EXPIRED_AD = 'ad_qa_expired';
const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const createdPosts = [];
const createdAttachments = [];

const b64 = ( value ) =>
	Buffer.from( JSON.stringify( value ) ).toString( 'base64' );

/**
 * Runs PHP inside the tests env; the payload travels base64-encoded so no quoting issues.
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
 * Resets beehiiv seams and seeds a "ready to send" site with an active ad list.
 */
function seed() {
	const mocks = [
		[
			'/advertisement_opportunities',
			{
				body: {
					data: [
						{
							id: ACTIVE_AD,
							advertiser_name: 'QA Advertiser',
							payout_rate: '1.00',
							advertisement_kind: 'cpc',
						},
					],
				},
			},
		],
		[ '/posts', { body: { data: { id: MOCK_CREATED_ID } } } ],
	];
	wpEvalWith(
		{ mocks },
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "QA E2E Template" ] ] );
		foreach ( $a["mocks"] as $m ) { beehiiv_e2e_mock_http( $m[0], $m[1] ); }
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a draft post fixture in the DB and empties the request log.
 *
 * @param {Object} options          Post fields.
 * @param {string} options.title    Post title.
 * @param {string} options.content  Post content (block markup).
 * @param {Object} [options.meta]   Post meta to set.
 * @param {number} [options.thumb]  Featured image attachment ID.
 * @param {string} [options.status] Post status.
 * @return {string} Post ID.
 */
function createPost( {
	title,
	content,
	meta = {},
	thumb = 0,
	status = 'draft',
} ) {
	const post = {
		post_type: 'post',
		post_title: title,
		post_content: content,
		post_status: status,
		post_author: 1,
	};
	const id = wpEvalWith(
		{ post, meta, thumb },
		`$id = wp_insert_post( $a["post"] );
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		if ( $a["thumb"] ) { set_post_thumbnail( $id, $a["thumb"] ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	return id;
}

/**
 * Creates an image attachment in the tests env's media library.
 *
 * @return {string} Attachment ID.
 */
function createAttachment() {
	const id = wpEvalWith(
		{ png: PNG_B64 },
		`$up = wp_upload_bits( "qa-e2e-featured.png", null, base64_decode( $a["png"] ) );
		$att = wp_insert_attachment( [ "post_mime_type" => "image/png", "post_title" => "QA featured", "post_status" => "inherit" ], $up["file"] );
		require_once ABSPATH . "wp-admin/includes/image.php";
		wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $up["file"] ) );
		echo $att . "\\n";`
	);
	createdAttachments.push( id );
	return id;
}

/**
 * All meta for a post, single values.
 *
 * @param {string} id Post ID.
 * @return {Object} Meta keyed by meta key.
 */
function getMeta( id ) {
	const raw = wpCli(
		`eval '$m = get_post_meta( ${ id } ); $o = []; foreach ( $m as $k => $v ) { $o[ $k ] = $v[0]; } echo wp_json_encode( (object) $o ) . "\\n";'`
	);
	return JSON.parse( raw );
}

/**
 * Returns the recorded outbound beehiiv requests.
 *
 * @return {Array} Request log entries.
 */
function getLog() {
	return JSON.parse(
		wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
}

/**
 * Clears the recorded request log.
 */
function clearLog() {
	wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
}

const creates = ( log ) =>
	log.filter(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);
const updates = ( log ) => log.filter( ( r ) => r.method === 'PATCH' );

/**
 * Logs in as admin and returns a REST caller bound to that session (cookie + nonce).
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<Function>} `( method, path, data ) => { status, body }`.
 */
async function restAs( page ) {
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
 * Publishes a new post with "Send to Newsletter" on and returns the `blocks`
 * beehiiv received in the create request.
 *
 * @param {import('@playwright/test').Page} page      Playwright page.
 * @param {string}                          content   Post content (block markup).
 * @param {Object}                          [options] Extra fixture options.
 * @return {Promise<{id: string, blocks: Array, rest: Function}>} Result.
 */
async function sendNew( page, content, options = {} ) {
	seed();
	const id = createPost( {
		title: 'QA E2E block conversion',
		content,
		meta: { [ META.send ]: '1', ...( options.meta || {} ) },
		thumb: options.thumb || 0,
	} );
	const rest = await restAs( page );
	const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
		status: 'publish',
	} );
	expect( res.status ).toBe( 200 );
	const created = creates( getLog() );
	expect( created ).toHaveLength( 1 );
	return { id, blocks: created[ 0 ].body.blocks, rest };
}

/**
 * Opens or closes the beehiiv sidebar, whatever state the editor remembered.
 *
 * @param {import('@playwright/test').Page} page Editor page.
 * @param {boolean}                         open Whether the sidebar should be open.
 */
async function setBeehiivSidebar( page, open ) {
	const content = page.locator( '.beehiiv-post-settings-content' );
	const remembered = await content
		.waitFor( { state: 'visible', timeout: 3000 } )
		.then( () => true )
		.catch( () => false );
	if ( remembered !== open ) {
		await page
			.getByRole( 'button', { name: 'beehiiv', exact: true } )
			.first()
			.click();
	}
	if ( open ) {
		await expect( content ).toBeVisible();
	} else {
		await expect( content ).toBeHidden();
	}
}

const p = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const h = ( text ) =>
	`<!-- wp:heading --><h2 class="wp-block-heading">${ text }</h2><!-- /wp:heading -->`;
const group = ( inner ) =>
	`<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group">${ inner }</div><!-- /wp:group -->`;
const types = ( blocks ) => blocks.map( ( b ) => b.type );
const text = ( blocks ) => JSON.stringify( blocks );

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
} );

test.afterAll( async () => {
	wpCliSafe(
		`eval 'foreach ( array( ${ createdPosts.join(
			', '
		) } ) as $id ) { delete_post_meta( $id, "${
			META.postId
		}" ); wp_delete_post( $id, true ); }
		foreach ( array( ${ createdAttachments.join(
			', '
		) } ) as $id ) { wp_delete_attachment( $id, true ); }
		delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: convert post blocks', () => {
	test( 'AC-001: heading, paragraph and image blocks convert without content loss', async ( {
		page,
	} ) => {
		const image =
			'<!-- wp:image --><figure class="wp-block-image"><img src="https://example.com/qa-photo.jpg" alt="QA alt"/></figure><!-- /wp:image -->';
		const { blocks } = await sendNew(
			page,
			h( 'QA heading text' ) + p( 'QA paragraph text.' ) + image
		);
		expect( types( blocks ) ).toEqual( [
			'heading',
			'paragraph',
			'image',
		] );
		expect( blocks[ 0 ].text ).toBe( 'QA heading text' );
		expect( blocks[ 1 ].plaintext ).toBe( 'QA paragraph text.' );
		expect( blocks[ 2 ].imageUrl ).toBe(
			'https://example.com/qa-photo.jpg'
		);
		expect( blocks[ 2 ].alt_text ).toBe( 'QA alt' );
	} );

	test( 'AC-002: separator blocks convert to a content break', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			p( 'Before' ) +
				'<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->' +
				p( 'After' )
		);
		expect( types( blocks ) ).toEqual( [
			'paragraph',
			'content_break',
			'paragraph',
		] );
	} );

	test( 'AC-003: embed blocks convert to a link to the embedded content', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			'<!-- wp:embed {"url":"https://www.youtube.com/watch?v=qa123","type":"video","providerNameSlug":"youtube"} --><figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://www.youtube.com/watch?v=qa123</div></figure><!-- /wp:embed -->' +
				p( 'Anchor paragraph' )
		);
		const embed = blocks.find( ( b ) => b.type === 'embed_link' );
		expect( embed ).toBeTruthy();
		expect( embed.url ).toBe( 'https://www.youtube.com/watch?v=qa123' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: skip unsupported blocks', () => {
	test( 'AC-004: blocks without beehiiv equivalents are silently omitted', async ( {
		page,
	} ) => {
		const { id, blocks } = await sendNew(
			page,
			p( 'Kept paragraph' ) +
				'<!-- wp:code --><pre class="wp-block-code"><code>QA_UNSUPPORTED_CODE</code></pre><!-- /wp:code -->' +
				'<!-- wp:verse --><pre class="wp-block-verse">QA_UNSUPPORTED_VERSE</pre><!-- /wp:verse -->' +
				'<!-- wp:spacer {"height":"40px"} --><div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->'
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph' ] );
		expect( text( blocks ) ).not.toContain( 'QA_UNSUPPORTED' );
		// The send still succeeds without an error recorded.
		expect( getMeta( id )[ META.postId ] ).toBe( MOCK_CREATED_ID );
		expect( getMeta( id )._beehiiv_newsletter_error ).toBeUndefined();
	} );

	test( 'AC-005: empty and whitespace-only blocks are omitted', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			p( 'Real content' ) +
				'<!-- wp:paragraph --><p></p><!-- /wp:paragraph -->' +
				'<!-- wp:paragraph --><p>   </p><!-- /wp:paragraph -->' +
				'<!-- wp:heading --><h2 class="wp-block-heading">  </h2><!-- /wp:heading -->'
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph' ] );
		expect( blocks[ 0 ].plaintext ).toBe( 'Real content' );
	} );

	// Known gap (QA finding): a block holding only a non-breaking space
	// (&nbsp;, which the editor produces for "blank" lines) is converted to a
	// paragraph/heading with a nbsp instead of being omitted. test.fail()
	// records the gap without breaking CI and starts failing once it is fixed.
	test( 'AC-005: blocks holding only a non-breaking space are omitted', async ( {
		page,
	} ) => {
		test.fail(
			true,
			'Known gap: &nbsp;-only paragraph and heading blocks are still sent.'
		);
		const { blocks } = await sendNew(
			page,
			p( 'Real content' ) +
				'<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->' +
				'<!-- wp:heading --><h2 class="wp-block-heading">&nbsp;</h2><!-- /wp:heading -->'
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph' ] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: snippet mode with Read More button', () => {
	test( 'AC-006: snippet mode stops at core/more and adds a Read More button to the permalink in a new tab', async ( {
		page,
	} ) => {
		const content =
			p( 'Teaser paragraph' ) +
			'<!-- wp:more --><!--more--><!-- /wp:more -->' +
			p( 'HIDDEN_AFTER_MORE' );
		const { id, blocks } = await sendNew( page, content, {
			meta: { [ META.snippet ]: '1' },
		} );
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'button' ] );
		expect( text( blocks ) ).not.toContain( 'HIDDEN_AFTER_MORE' );
		const button = blocks[ 1 ];
		expect( button.text ).toBe( 'Read More' );
		expect( button.target ).toBe( '_blank' );
		const permalink = wpCli( `eval 'echo get_permalink( ${ id } );'` );
		expect( button.href ).toBe( permalink );
		expect( button.href ).toContain( 'qa-e2e-block-conversion' );

		// Edge case: snippet mode with no core/more converts every block.
		const noMore = await sendNew( page, p( 'One' ) + p( 'Two' ), {
			meta: { [ META.snippet ]: '1' },
		} );
		expect( types( noMore.blocks ) ).toEqual( [
			'paragraph',
			'paragraph',
		] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: featured image', () => {
	test( 'AC-007: the featured image leads the newsletter and is configured for email only', async ( {
		page,
	} ) => {
		const thumb = createAttachment();
		const { blocks } = await sendNew( page, p( 'Body text' ), { thumb } );
		expect( types( blocks ) ).toEqual( [ 'image', 'paragraph' ] );
		expect( blocks[ 0 ].imageUrl ).toContain( 'qa-e2e-featured' );
		expect( blocks[ 0 ].visibility_settings ).toEqual( {
			show_on_email: true,
			show_on_web: false,
		} );

		// Edge case: no featured image is omitted without error.
		const none = await sendNew( page, p( 'No image' ) );
		expect( types( none.blocks ) ).toEqual( [ 'paragraph' ] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-005: advertisement validation', () => {
	test( 'AC-008: advertisement blocks are included only for a valid, active ad', async ( {
		page,
	} ) => {
		const ad = ( attrs ) =>
			`<!-- wp:beehiiv/advertisement ${ JSON.stringify( attrs ) } /-->`;

		// Active ad: included with its opportunity id.
		const active = await sendNew(
			page,
			p( 'Intro' ) + ad( { adId: ACTIVE_AD } )
		);
		const ads = active.blocks.filter( ( b ) => b.type === 'advertisement' );
		expect( ads ).toHaveLength( 1 );
		expect( ads[ 0 ].opportunity_id ).toBe( ACTIVE_AD );

		// Expired/unknown ad: never reaches beehiiv. (The sender rejects the
		// whole send with an error instead of silently dropping the block, so
		// no create request is made at all.)
		seed();
		const id = createPost( {
			title: 'QA E2E block conversion expired ad',
			content: p( 'Intro' ) + ad( { adId: EXPIRED_AD } ),
			meta: { [ META.send ]: '1' },
		} );
		const rest = await restAs( page );
		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const log = getLog();
		expect( JSON.stringify( log ) ).not.toContain(
			`"opportunity_id":"${ EXPIRED_AD }"`
		);
		expect( creates( log ) ).toHaveLength( 0 );
		expect( getMeta( id )._beehiiv_newsletter_error ).toContain(
			'no longer available'
		);
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-006: Group blocks become sections', () => {
	test( 'AC-009: a Group becomes one section with its inner blocks in original order', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			p( 'Outside before' ) +
				group(
					h( 'Inside heading' ) +
						p( 'Inside one' ) +
						p( 'Inside two' )
				) +
				p( 'Outside after' )
		);
		expect( types( blocks ) ).toEqual( [
			'paragraph',
			'section',
			'paragraph',
		] );
		const section = blocks[ 1 ];
		expect( types( section.blocks ) ).toEqual( [
			'heading',
			'paragraph',
			'paragraph',
		] );
		expect( section.blocks[ 0 ].text ).toBe( 'Inside heading' );
		expect( section.blocks[ 1 ].plaintext ).toBe( 'Inside one' );
		expect( section.blocks[ 2 ].plaintext ).toBe( 'Inside two' );
	} );

	test( 'AC-010: a Group nested in a Group is omitted, so no section holds a section', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			group(
				p( 'Outer text' ) +
					group( p( 'Nested text' ) ) +
					p( 'Last text' )
			)
		);
		expect( types( blocks ) ).toEqual( [ 'section' ] );
		expect( types( blocks[ 0 ].blocks ) ).toEqual( [
			'paragraph',
			'paragraph',
		] );
		expect( JSON.stringify( blocks ) ).not.toContain( 'Nested text' );
	} );

	test( 'AC-010: the editor notice counts a nested Group as omitted and marks it', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E nested group notice',
			content: group( p( 'Outer text' ) + group( p( 'Nested text' ) ) ),
			meta: { [ META.send ]: '1' },
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		await setBeehiivSidebar( page, true );

		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toContainText( '1 block will be omitted from this newsletter.' );
		// It follows the send warning text, so there is a gap above it.
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCSS( 'margin-top', '10px' );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			1
		);
		// The class sits on the Group block itself; no wrapper element is added.
		await expect(
			canvas.locator(
				'.wp-block-group .wp-block-group.beehiiv-omitted-block'
			)
		).toHaveCount( 1 );
		await expect(
			canvas.locator( '.beehiiv-omitted-block:not(.wp-block)' )
		).toHaveCount( 0 );
		// The hidden-eye icon is always drawn, without hovering the block.
		const icon = await canvas
			.locator( '.beehiiv-omitted-block' )
			.evaluate( ( el ) => {
				const style = window.getComputedStyle( el, '::after' );
				return { content: style.content, opacity: style.opacity };
			} );
		expect( icon.content ).not.toBe( 'none' );
		expect( icon.opacity ).toBe( '1' );

		// Closing the beehiiv sidebar removes the marks from the canvas.
		await setBeehiivSidebar( page, false );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			0
		);
		await setBeehiivSidebar( page, true );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			1
		);
	} );

	test( 'AC-010: a scheduled, linked post shows the omitted notice for a nested Group, and a sent one does not', async ( {
		page,
	} ) => {
		seed();
		const linked = ( scheduledAt ) => ( {
			[ META.postId ]: 'post_qa_e2e_scheduled',
			_beehiiv_publication_id: PUBLICATION_ID,
			_beehiiv_post_template_id: TEMPLATE_ID,
			_beehiiv_linked_publication_id: PUBLICATION_ID,
			_beehiiv_linked_post_template_id: TEMPLATE_ID,
			[ META.send ]: '',
			_beehiiv_scheduled_at: scheduledAt,
		} );
		const content = group(
			p( 'Outer text' ) + group( p( 'Nested text' ) )
		);
		const scheduledId = createPost( {
			title: 'QA E2E scheduled nested group',
			content,
			status: 'publish',
			meta: linked( '2031-01-01T10:00:00Z' ),
		} );
		const sentId = createPost( {
			title: 'QA E2E sent nested group',
			content,
			status: 'publish',
			meta: linked( '2020-01-01T10:00:00Z' ),
		} );
		await loginAsAdmin( page );

		await openPostEditor( page, scheduledId );
		await setBeehiivSidebar( page, true );
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toContainText( '1 block will be omitted from this newsletter.' );
		// Alone in its notice, so no gap above it.
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCSS( 'margin-top', '0px' );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			1
		);

		await openPostEditor( page, sentId );
		await setBeehiivSidebar( page, true );
		await expect(
			page.locator( '.beehiiv-post-settings-content' )
		).toBeVisible();
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCount( 0 );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			0
		);
	} );

	test( 'AC-010: the editor shows no omitted notice for a single, non-nested Group', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E single group notice',
			content: group( p( 'Only text' ) ),
			meta: { [ META.send ]: '1' },
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		await setBeehiivSidebar( page, true );

		await expect(
			page.locator( '.beehiiv-post-settings-notice__text' )
		).toBeVisible();
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCount( 0 );
	} );

	test( 'AC-011: Group background color, text color, padding and margin become the section visual settings', async ( {
		page,
	} ) => {
		const styled =
			'<!-- wp:group {"style":{"color":{"background":"#ff0000","text":"#ffffff"},"spacing":{"padding":{"top":"40px","bottom":"2.5rem","left":"20px","right":"10%"},"margin":{"top":"12px","bottom":"1.5rem"}}},"layout":{"type":"constrained"}} --><div class="wp-block-group has-text-color has-background" style="color:#ffffff;background-color:#ff0000;margin-top:12px;margin-bottom:1.5rem;padding-top:40px;padding-right:10%;padding-bottom:2.5rem;padding-left:20px">' +
			p( 'Styled group text' ) +
			'</div><!-- /wp:group -->';
		const { blocks } = await sendNew( page, styled );
		expect( blocks ).toHaveLength( 1 );
		expect( blocks[ 0 ].type ).toBe( 'section' );
		expect( Object.keys( blocks[ 0 ] ).sort() ).toEqual( [
			'blocks',
			'type',
			'visual_settings',
		] );
		// Padding and margin become inner and outer spacing. rem converts to pixels; a percentage
		// cannot, so that side is left out.
		expect( blocks[ 0 ].visual_settings ).toEqual( {
			background_color: '#ff0000',
			text_color: '#ffffff',
			inner_spacing_top: 40,
			inner_spacing_bottom: 40,
			inner_spacing_left: 20,
			outer_spacing_top: 12,
			outer_spacing_bottom: 24,
		} );
	} );

	test( 'AC-015: Group border color, width, style and radius become the section visual settings', async ( {
		page,
	} ) => {
		const bordered =
			'<!-- wp:group {"style":{"border":{"color":"#00aa55","width":"3px","style":"dashed","radius":{"topLeft":"4px","topRight":"8px","bottomLeft":"1rem","bottomRight":"50%"}}},"layout":{"type":"constrained"}} --><div class="wp-block-group has-border-color" style="border-color:#00aa55;border-style:dashed;border-width:3px;border-top-left-radius:4px;border-top-right-radius:8px;border-bottom-left-radius:1rem;border-bottom-right-radius:50%">' +
			p( 'Bordered group text' ) +
			'</div><!-- /wp:group -->';
		const { blocks } = await sendNew( page, bordered );
		expect( blocks ).toHaveLength( 1 );
		expect( blocks[ 0 ].type ).toBe( 'section' );
		// A radius in percent cannot become pixels, so that corner is left out.
		expect( blocks[ 0 ].visual_settings ).toEqual( {
			border_color: '#00aa55',
			border_width: 3,
			border_style: 'dashed',
			border_radius_top_left: 4,
			border_radius_top_right: 8,
			border_radius_bottom_left: 16,
		} );
	} );

	test( 'AC-015: a border with a different width on each side still sends its color', async ( {
		page,
	} ) => {
		// The editor stores a palette color on a split border as var:preset|color|slug on each side.
		const side = ( width ) =>
			`{"color":"var:preset|color|accent","width":"${ width }"}`;
		const split =
			`<!-- wp:group {"style":{"border":{"top":${ side(
				'1px'
			) },"right":${ side( '3px' ) },"bottom":${ side(
				'5px'
			) },"left":${ side(
				'7px'
			) }}},"layout":{"type":"constrained"}} --><div class="wp-block-group">` +
			p( 'Split border group text' ) +
			'</div><!-- /wp:group -->';
		const { blocks } = await sendNew( page, split );
		const settings = blocks[ 0 ].visual_settings;
		expect( settings.border_color ).toMatch( /^#[0-9a-f]{3,8}$/i );
		expect( settings.border_style ).toBe( 'solid' );
		expect( [
			settings.border_width_top,
			settings.border_width_right,
			settings.border_width_bottom,
			settings.border_width_left,
		] ).toEqual( [ 1, 3, 5, 7 ] );
	} );

	test( 'AC-011: a Group with no styling sends a section without visual settings', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew( page, group( p( 'Plain text' ) ) );
		expect( Object.keys( blocks[ 0 ] ).sort() ).toEqual( [
			'blocks',
			'type',
		] );
	} );

	test( 'AC-012: an empty or unconvertible Group produces no section; a mixed Group keeps only convertible blocks', async ( {
		page,
	} ) => {
		const empty = await sendNew(
			page,
			p( 'Kept outside' ) +
				group( '' ) +
				group(
					'<!-- wp:code --><pre class="wp-block-code"><code>QA_CODE_ONLY</code></pre><!-- /wp:code -->'
				)
		);
		expect( types( empty.blocks ) ).toEqual( [ 'paragraph' ] );

		const mixed = await sendNew(
			page,
			group(
				p( 'Mixed one' ) +
					'<!-- wp:code --><pre class="wp-block-code"><code>QA_CODE_DROPPED</code></pre><!-- /wp:code -->' +
					p( 'Mixed two' )
			)
		);
		expect( types( mixed.blocks ) ).toEqual( [ 'section' ] );
		expect( types( mixed.blocks[ 0 ].blocks ) ).toEqual( [
			'paragraph',
			'paragraph',
		] );
		expect( text( mixed.blocks ) ).not.toContain( 'QA_CODE_DROPPED' );
	} );

	// The "shows as one grouped section in the beehiiv editor" half of this AC
	// depends on beehiiv's own editor and cannot be driven here; the payload
	// half (one section, three children) is what the plugin controls.
	test( 'AC-013: a Group with a heading and two paragraphs produces one section with those three children', async ( {
		page,
	} ) => {
		const { blocks } = await sendNew(
			page,
			group(
				h( 'Group heading' ) + p( 'Group para A' ) + p( 'Group para B' )
			)
		);
		const sections = blocks.filter( ( b ) => b.type === 'section' );
		expect( blocks ).toHaveLength( 1 );
		expect( sections ).toHaveLength( 1 );
		expect( types( sections[ 0 ].blocks ) ).toEqual( [
			'heading',
			'paragraph',
			'paragraph',
		] );
	} );

	test( 'AC-014: Group conversion applies to posts first synced after the change, including re-syncs; older posts keep omitting Group content', async ( {
		page,
	} ) => {
		const content =
			p( 'Top level text' ) + group( p( 'GROUPED_CONTENT_TEXT' ) );

		// Post first synced now: sections on create, marker stored, kept on re-sync.
		const fresh = await sendNew( page, content );
		expect( types( fresh.blocks ) ).toEqual( [ 'paragraph', 'section' ] );
		expect( getMeta( fresh.id )[ META.groupSections ] ).toBeTruthy();
		clearLog();
		await fresh.rest( 'POST', `/wp/v2/posts/${ fresh.id }`, {
			content: content + p( 'Edited later' ),
		} );
		const resynced = updates( getLog() );
		expect( resynced ).toHaveLength( 1 );
		expect( types( resynced[ 0 ].body.blocks ) ).toEqual( [
			'paragraph',
			'section',
			'paragraph',
		] );
		expect( text( resynced[ 0 ].body.blocks ) ).toContain(
			'GROUPED_CONTENT_TEXT'
		);

		// Post first synced before the change (linked, no marker): Group stays omitted.
		seed();
		const legacy = createPost( {
			title: 'QA E2E block conversion legacy',
			content,
			status: 'publish',
			meta: { [ META.postId ]: LEGACY_ID },
		} );
		const rest = await restAs( page );
		await rest( 'POST', `/wp/v2/posts/${ legacy }`, {
			content: content + p( 'Edited legacy' ),
		} );
		const legacyUpdates = updates( getLog() );
		expect( legacyUpdates ).toHaveLength( 1 );
		expect( types( legacyUpdates[ 0 ].body.blocks ) ).toEqual( [
			'paragraph',
			'paragraph',
		] );
		expect( text( legacyUpdates[ 0 ].body.blocks ) ).not.toContain(
			'GROUPED_CONTENT_TEXT'
		);
		expect( getMeta( legacy )[ META.groupSections ] ).toBeUndefined();
	} );
} );
