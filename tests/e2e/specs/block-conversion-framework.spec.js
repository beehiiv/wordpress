const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
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
 * - includes/Newsletter/BlockConverter.php -- block walk, snippet mode,
 *   featured image, advertisement validation.
 * - includes/Newsletter/SupportedBlocks.php -- which blocks are converted.
 *
 * Each test publishes a post through the REST endpoint the block editor uses
 * (POST /wp/v2/posts/{id}, cookie + nonce), with "Send to Newsletter" on.
 * The test-only `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php
 * answers the beehiiv calls and records them, so each test asserts on the
 * exact `blocks` payload the plugin sent. Nothing reaches the live API.
 */

const META_SEND = '_beehiiv_send_to_newsletter';
const META_SNIPPET = '_beehiiv_send_to_newsletter_snippet';
const PUBLICATION_ID = 'pub_qa_e2e_bcf';
const TEMPLATE_ID = 'tpl_qa_e2e_bcf';
const IMG = 'https://example.com/qa-image.jpg';

const createdPosts = [];

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
 * Seeds a connected, ready-to-send site and mocks the beehiiv endpoints.
 *
 * @param {string[]} activeAdIds Ad opportunity ids the mock reports as active.
 */
function seed( activeAdIds = [] ) {
	wpEvalWith(
		{ ads: activeAdIds.map( ( id ) => ( { id } ) ) },
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "QA E2E Template" ] ] );
		beehiiv_e2e_mock_http( "/advertisement_opportunities", [ "body" => [ "data" => $a["ads"] ] ] );
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "post_qa_e2e_bcf" ] ] ] );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Logs in as admin and returns a REST caller bound to that session.
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
 * Publishes a post and returns the blocks sent to beehiiv.
 *
 * @param {import('@playwright/test').Page} page                  Playwright page.
 * @param {string}                          content               Serialized block markup.
 * @param {Object}                          [options]             Post options.
 * @param {boolean}                         [options.snippet]     Turn snippet mode on.
 * @param {boolean}                         [options.thumbnail]   Attach a featured image.
 * @param {string[]}                        [options.activeAdIds] Ad ids the mock reports as active.
 * @param {boolean}                         [options.allowNoSend] Return null instead of failing when no create request is sent.
 * @return {Promise<Array|null>} The `blocks` array of the create-post request.
 */
async function convert(
	page,
	content,
	{
		snippet = false,
		thumbnail = false,
		activeAdIds = [],
		allowNoSend = false,
	} = {}
) {
	seed( activeAdIds );
	const id = wpEvalWith(
		{ content, snippet, thumbnail },
		`$id = wp_insert_post( [ "post_type" => "post", "post_title" => "QA E2E block conversion", "post_content" => $a["content"], "post_status" => "draft", "post_author" => 1 ] );
		update_post_meta( $id, "${ META_SEND }", "1" );
		if ( $a["snippet"] ) { update_post_meta( $id, "${ META_SNIPPET }", "1" ); }
		if ( $a["thumbnail"] ) {
			require_once ABSPATH . "wp-admin/includes/image.php";
			$upload = wp_upload_bits( "qa-e2e-bcf-" . $id . ".png", null, base64_decode( "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" ) );
			$att = wp_insert_attachment( [ "post_mime_type" => "image/png", "post_title" => "QA featured", "post_status" => "inherit" ], $upload["file"], $id );
			wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $upload["file"] ) );
			set_post_thumbnail( $id, $att );
		}
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	const rest = await restAs( page );
	const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
		status: 'publish',
	} );
	expect( res.status ).toBe( 200 );
	const log = JSON.parse(
		wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
	const create = log.find(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);
	if ( allowNoSend && ! create ) {
		return null;
	}
	expect( create, 'beehiiv create-post request was sent' ).toBeTruthy();
	return create.body.blocks || [];
}

// ---------------------------------------------------------------------------
// Block markup builders.
// ---------------------------------------------------------------------------

const p = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const h = ( text ) =>
	`<!-- wp:heading --><h2 class="wp-block-heading">${ text }</h2><!-- /wp:heading -->`;
const img = () =>
	`<!-- wp:image --><figure class="wp-block-image"><img src="${ IMG }" alt=""/></figure><!-- /wp:image -->`;
const group = ( inner ) =>
	`<!-- wp:group --><div class="wp-block-group">${ inner }</div><!-- /wp:group -->`;
const more = () => `<!-- wp:more --><!--more--><!-- /wp:more -->`;
const ad = ( adId ) =>
	`<!-- wp:beehiiv/advertisement ${ JSON.stringify(
		adId ? { adId } : {}
	) } /-->`;

const types = ( blocks ) => blocks.map( ( b ) => b.type );
const textOf = ( block ) =>
	block.text ||
	( block.formattedText || [] ).map( ( r ) => r.text ).join( '' ) ||
	block.plaintext ||
	'';

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
} );

test.afterAll( async () => {
	wpCliSafe(
		`eval 'foreach ( array( ${ createdPosts.join(
			', '
		) } ) as $id ) { delete_post_meta( $id, "_beehiiv_post_id" ); wp_delete_post( $id, true ); }
		delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: convert post blocks', () => {
	test( 'AC-001: heading, paragraph and image blocks convert without content loss', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			h( 'QA Heading Text' ) + p( 'QA paragraph body text.' ) + img()
		);
		expect( types( blocks ) ).toEqual( [
			'heading',
			'paragraph',
			'image',
		] );
		expect( blocks[ 0 ].text ).toBe( 'QA Heading Text' );
		expect( textOf( blocks[ 1 ] ) ).toBe( 'QA paragraph body text.' );
		expect( blocks[ 2 ].imageUrl ).toBe( IMG );
	} );

	test( 'AC-002: separator block converts to a content break', async ( {
		page,
	} ) => {
		const blocks = await convert(
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

	test( 'AC-003: embed block converts to a link to the embedded content', async ( {
		page,
	} ) => {
		const url = 'https://www.youtube.com/watch?v=qa-e2e';
		const blocks = await convert(
			page,
			`<!-- wp:embed ${ JSON.stringify( {
				url,
				type: 'video',
				providerNameSlug: 'youtube',
			} ) } --><figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">\n${ url }\n</div></figure><!-- /wp:embed -->`
		);
		expect( blocks ).toHaveLength( 1 );
		expect( blocks[ 0 ].type ).toBe( 'embed_link' );
		expect( blocks[ 0 ].url ).toBe( url );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: skip unsupported blocks', () => {
	test( 'AC-004: blocks without a beehiiv equivalent are silently omitted', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			p( 'Kept before' ) +
				group( p( 'Inside group' ) + h( 'Group heading' ) ) +
				'<!-- wp:spacer --><div style="height:20px" aria-hidden="true" class="wp-block-spacer"></div><!-- /wp:spacer -->' +
				p( 'Kept after' )
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'paragraph' ] );
		expect( blocks.map( textOf ) ).toEqual( [
			'Kept before',
			'Kept after',
		] );
	} );

	test( 'AC-005: empty and whitespace-only blocks are omitted', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			p( 'Real text' ) +
				'<!-- wp:paragraph --><p></p><!-- /wp:paragraph -->' +
				'<!-- wp:paragraph --><p>   &nbsp;  </p><!-- /wp:paragraph -->' +
				'<!-- wp:heading --><h2 class="wp-block-heading">  </h2><!-- /wp:heading -->' +
				p( 'More text' )
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'paragraph' ] );
		expect( blocks.map( textOf ) ).toEqual( [ 'Real text', 'More text' ] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: snippet mode', () => {
	test( 'AC-006: snippet mode stops at the more block and adds a Read More button to the permalink in a new tab', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			p( 'Teaser' ) + more() + p( 'Hidden after more' ),
			{ snippet: true }
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'button' ] );
		expect( blocks[ 1 ].text ).toBe( 'Read More' );
		expect( blocks[ 1 ].target ).toBe( '_blank' );
		const id = createdPosts[ createdPosts.length - 1 ];
		const permalink = wpCli( `post get ${ id } --field=url` );
		expect( blocks[ 1 ].href ).toBe( permalink );
		expect( JSON.stringify( blocks ) ).not.toContain( 'Hidden after more' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: featured image', () => {
	test( 'AC-007: featured image is prepended and set to show in email only', async ( {
		page,
	} ) => {
		const blocks = await convert( page, p( 'Body' ), { thumbnail: true } );
		expect( types( blocks ) ).toEqual( [ 'image', 'paragraph' ] );
		expect( blocks[ 0 ].imageUrl ).toContain( 'qa-e2e-bcf-' );
		expect( blocks[ 0 ].visibility_settings ).toEqual( {
			show_on_email: true,
			show_on_web: false,
		} );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-005: advertisement validation', () => {
	test( 'AC-008: advertisement blocks are included only for a valid, active ad', async ( {
		page,
	} ) => {
		// Active ad: kept, with its opportunity id.
		let blocks = await convert( page, p( 'Body' ) + ad( 'ad_active' ), {
			activeAdIds: [ 'ad_active' ],
		} );
		const kept = blocks.filter( ( b ) => b.type === 'advertisement' );
		expect( kept ).toHaveLength( 1 );
		expect( kept[ 0 ].opportunity_id ).toBe( 'ad_active' );

		// Ad no longer active (deleted or expired): the block is never
		// included. The send path rejects the post before conversion, so no
		// create-post request goes out at all.
		blocks = await convert( page, p( 'Body' ) + ad( 'ad_gone' ), {
			activeAdIds: [ 'ad_other' ],
			allowNoSend: true,
		} );
		expect( blocks ).toBeNull();

		// No ad selected: the block is never included either.
		blocks = await convert( page, p( 'Body' ) + ad( '' ), {
			activeAdIds: [ 'ad_active' ],
			allowNoSend: true,
		} );
		expect( blocks ).toBeNull();
	} );
} );
