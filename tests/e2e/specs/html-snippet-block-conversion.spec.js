const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { openPostEditor, saveDraft } = require( '../utils/editor' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/2-block-conversion/html-snippet-block-conversion.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/Converters/HtmlBlockConverter.php -- snippet building.
 * - includes/Newsletter/BlockConverter.php -- block walk, Group, Columns and
 *   Media & Text routing.
 * - includes/Editor/NewsletterOnlyHtml.php -- the render-time hiding.
 * - src/js/editor/post-settings/filters/with-newsletter-only-html.js -- the
 *   sidebar option, label and notice.
 *
 * Payload tests save a post through the REST endpoint the block editor uses
 * (POST /wp/v2/posts/{id}, cookie + nonce). The test-only `pre_http_request`
 * mock in tests/e2e/plugins/beehiiv-options.php answers the beehiiv call and
 * records it, so each test asserts on the exact `blocks` payload the plugin
 * sent. Nothing reaches the live API.
 *
 * AUTHORED, NOT RUN: these specs were written on a machine with no Docker, so
 * they have never executed. A failure may be the spec's own fault.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	postId: '_beehiiv_post_id',
};

const PUBLICATION_ID = 'pub_qa_e2e_html';
const TEMPLATE_ID = 'tpl_qa_e2e_html';
const MOCK_CREATED_ID = 'post_qa_e2e_html_created';
const IMG = 'https://example.com/qa-image.jpg';
const OMITTED_NOTICE = '.beehiiv-post-settings-notice__omitted';
const UNSUPPORTED_NOTICE = '.beehiiv-html-unsupported-notice';
const NEWSLETTER_ONLY_LABEL = '.beehiiv-newsletter-only-label';

/**
 * Returns, for each element matching `selector`, the position among the Custom
 * HTML blocks of the block it belongs to.
 *
 * The label and the notice render just before their block, as siblings of the
 * block element, not inside it. So each one belongs to the next Custom HTML
 * block after it.
 *
 * @param {import('@playwright/test').FrameLocator} canvas   Editor canvas.
 * @param {string}                                  selector CSS selector of the label or notice.
 * @return {Promise<number[]>} Block positions, in document order.
 */
async function ownersOf( canvas, selector ) {
	return canvas.locator( selector ).evaluateAll( ( elements ) =>
		elements.map( ( element ) => {
			const all = [
				...element.ownerDocument.querySelectorAll(
					'[data-type="core/html"]'
				),
			];
			let next = element.nextElementSibling;
			while ( next && next.dataset.type !== 'core/html' ) {
				next = next.nextElementSibling;
			}
			return all.indexOf( next );
		} )
	);
}

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
 * Seeds a connected, ready-to-send site and mocks the beehiiv posts endpoint.
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
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a draft post fixture in the DB.
 *
 * The current user is set to the admin first, so WordPress does not strip
 * script, iframe and style elements from the fixture content.
 *
 * @param {Object}  options         Post fields.
 * @param {string}  options.content Post content (block markup).
 * @param {boolean} [options.send]  Whether "Send to Newsletter" is on.
 * @return {string} Post ID.
 */
function createPost( { content, send = false } ) {
	const post = {
		post_type: 'post',
		post_title: 'QA E2E html snippet',
		post_content: content,
		post_status: 'draft',
		post_author: 1,
	};
	const id = wpEvalWith(
		{ post, send },
		`wp_set_current_user( 1 );
		$id = wp_insert_post( $a["post"] );
		if ( $a["send"] ) { update_post_meta( $id, "${ META.send }", "1" ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	return id;
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
 * Publishes a new post and returns what was sent to beehiiv, when it was sent.
 *
 * @param {import('@playwright/test').Page} page           Playwright page.
 * @param {string}                          content        Post content (block markup).
 * @param {Object}                          [options]      Options.
 * @param {boolean}                         [options.send] Send to the newsletter (default true).
 * @return {Promise<{id: string, link: string, blocks: Array, rest: Function}>} Result.
 */
async function publish( page, content, { send = true } = {} ) {
	seed();
	const id = createPost( { content, send } );
	const rest = await restAs( page );
	const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
		status: 'publish',
	} );
	expect( res.status ).toBe( 200 );
	let blocks = [];
	if ( send ) {
		const created = creates( getLog() );
		expect( created, 'beehiiv create-post request was sent' ).toHaveLength(
			1
		);
		blocks = created[ 0 ].body.blocks || [];
	}
	return { id, link: res.body.link, blocks, rest };
}

// ---------------------------------------------------------------------------
// Block markup builders.
// ---------------------------------------------------------------------------

const p = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const code = ( text ) =>
	`<!-- wp:code --><pre class="wp-block-code"><code>${ text }</code></pre><!-- /wp:code -->`;

/**
 * Builds a Custom HTML block.
 *
 * @param {string}  source         The HTML the publisher typed.
 * @param {Object}  [options]      Options.
 * @param {boolean} [options.only] "Newsletter only" option value.
 * @return {string} Serialized block.
 */
const html = ( source, { only } = {} ) => {
	const attrs =
		only === undefined
			? ''
			: ` ${ JSON.stringify( { beehiivNewsletterOnly: only } ) }`;
	return `<!-- wp:html${ attrs } -->\n${ source }\n<!-- /wp:html -->`;
};

const group = ( inner ) =>
	`<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group">${ inner }</div><!-- /wp:group -->`;

const col = ( inner ) =>
	`<!-- wp:column --><div class="wp-block-column">${ inner }</div><!-- /wp:column -->`;

const columns = ( cols ) =>
	`<!-- wp:columns --><div class="wp-block-columns">${ cols.join(
		''
	) }</div><!-- /wp:columns -->`;

const mediaText = ( inner ) =>
	`<!-- wp:media-text ${ JSON.stringify( {
		mediaId: 1,
		mediaType: 'image',
		mediaWidth: 30,
	} ) } --><div class="wp-block-media-text is-stacked-on-mobile" style="grid-template-columns:30% auto"><figure class="wp-block-media-text__media"><img src="${ IMG }" alt="a"/></figure><div class="wp-block-media-text__content">${ inner }</div></div><!-- /wp:media-text -->`;

const types = ( blocks ) => blocks.map( ( b ) => b.type );
const snippets = ( blocks ) => blocks.filter( ( b ) => b.type === 'html' );
const snippetHtml = ( blocks ) => snippets( blocks ).map( ( b ) => b.html );

// Sample advertiser HTML.
const STYLED =
	'<div style="background:#fff3cd;padding:12px"><a href="https://example.com/offer?utm_source=qa&utm_medium=email">QA_STYLED_OFFER</a></div>';
const PIXEL =
	'<img src="https://example.com/pixel.gif?id=qa-track" width="1" height="1" alt="">';

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
} );

test.afterAll( async () => {
	if ( createdPosts.length ) {
		wpCliSafe(
			`eval 'foreach ( array( ${ createdPosts.join(
				', '
			) } ) as $id ) { delete_post_meta( $id, "${
				META.postId
			}" ); wp_delete_post( $id, true ); }
			delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
		);
	}
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: send Custom HTML to the newsletter', () => {
	test( 'AC-001: each non-empty Custom HTML block converts to one HTML snippet in its original position', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			p( 'Before' ) + html( '<div>QA_ONE</div>' ) + p( 'After' )
		);
		expect( types( blocks ) ).toEqual( [
			'paragraph',
			'html',
			'paragraph',
		] );
		expect( blocks[ 1 ].html ).toBe( '<div>QA_ONE</div>' );
	} );

	test( 'AC-002: the HTML arrives as written, with inline styles, tracking pixel and tracking links unchanged and no wrapper', async ( {
		page,
	} ) => {
		const source = `${ STYLED }\n<table><tr><td>QA_CELL</td></tr></table>\n${ PIXEL }`;
		const { blocks } = await publish( page, html( source ) );
		const found = snippets( blocks );
		expect( found ).toHaveLength( 1 );
		// Exact string: no added wrapper, no reformatting (BR-001).
		expect( found[ 0 ].html ).toBe( source );
		expect( found[ 0 ].html ).toContain( 'utm_source=qa&utm_medium=email' );
		expect( found[ 0 ].html ).toContain( 'width="1" height="1"' );
		expect( Object.keys( found[ 0 ] ).sort() ).toEqual( [
			'html',
			'type',
		] );
	} );

	test( 'AC-003: several Custom HTML blocks produce several snippets in the original order and are never merged', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			html( '<div>QA_FIRST</div>' ) +
				p( 'Between' ) +
				html( '<div>QA_SECOND</div>' ) +
				html( '<div>QA_THIRD</div>' )
		);
		expect( types( blocks ) ).toEqual( [
			'html',
			'paragraph',
			'html',
			'html',
		] );
		expect( snippetHtml( blocks ) ).toEqual( [
			'<div>QA_FIRST</div>',
			'<div>QA_SECOND</div>',
			'<div>QA_THIRD</div>',
		] );
	} );

	test( 'AC-004: an empty or whitespace-only Custom HTML block produces no snippet', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			p( 'Before' ) +
				'<!-- wp:html --><!-- /wp:html -->' +
				html( '   \n\t  ' ) +
				p( 'After' )
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'paragraph' ] );
	} );

	test( 'AC-005: a Custom HTML block inside a Group stays inside the Group section, in its original position', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			p( 'Top' ) +
				group(
					p( 'Group first' ) +
						html( '<div>QA_IN_GROUP</div>' ) +
						p( 'Group last' )
				)
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'section' ] );
		const section = blocks[ 1 ];
		expect( types( section.blocks ) ).toEqual( [
			'paragraph',
			'html',
			'paragraph',
		] );
		expect( section.blocks[ 1 ].html ).toBe( '<div>QA_IN_GROUP</div>' );
	} );

	test( "AC-006: a Custom HTML block inside Columns or Media & Text is sent right after that block's columns block, in order, never dropped", async ( {
		page,
	} ) => {
		const inColumns = await publish(
			page,
			p( 'Top' ) +
				columns( [
					col( p( 'Left text' ) + html( '<div>QA_COL_A</div>' ) ),
					col( html( '<div>QA_COL_B</div>' ) + p( 'Right text' ) ),
				] ) +
				p( 'Tail' )
		);
		expect( types( inColumns.blocks ) ).toEqual( [
			'paragraph',
			'columns',
			'html',
			'html',
			'paragraph',
		] );
		expect( snippetHtml( inColumns.blocks ) ).toEqual( [
			'<div>QA_COL_A</div>',
			'<div>QA_COL_B</div>',
		] );
		// The columns block itself holds none of the HTML.
		expect( JSON.stringify( inColumns.blocks[ 1 ] ) ).not.toContain(
			'QA_COL_'
		);

		const inMediaText = await publish(
			page,
			p( 'Top' ) +
				mediaText( p( 'Side text' ) + html( '<div>QA_MEDIA</div>' ) ) +
				p( 'Tail' )
		);
		expect( types( inMediaText.blocks ) ).toEqual( [
			'paragraph',
			'columns',
			'html',
			'paragraph',
		] );
		expect( inMediaText.blocks[ 2 ].html ).toBe( '<div>QA_MEDIA</div>' );
		expect( JSON.stringify( inMediaText.blocks[ 1 ] ) ).not.toContain(
			'QA_MEDIA'
		);
	} );

	test( 'AC-007: syncing an updated post updates the snippet content and does not add a second snippet', async ( {
		page,
	} ) => {
		const { id, rest } = await publish(
			page,
			p( 'Intro' ) + html( '<div>QA_VERSION_ONE</div>' )
		);
		clearLog();
		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			content: p( 'Intro' ) + html( '<div>QA_VERSION_TWO</div>' ),
		} );
		expect( res.status ).toBe( 200 );
		const log = getLog();
		// The linked post is updated in place, never created again.
		expect( creates( log ) ).toHaveLength( 0 );
		const patched = updates( log );
		expect( patched ).toHaveLength( 1 );
		expect( types( patched[ 0 ].body.blocks ) ).toEqual( [
			'paragraph',
			'html',
		] );
		expect( snippetHtml( patched[ 0 ].body.blocks ) ).toEqual( [
			'<div>QA_VERSION_TWO</div>',
		] );
	} );

	test( 'AC-008: a Custom HTML block is not marked omitted in the editor and is not counted in the omitted-block notice', async ( {
		page,
	} ) => {
		seed();
		// A Code block is omitted today, so it proves the marks are working
		// and that only it is counted.
		const id = createPost( {
			content:
				p( 'Kept text' ) +
				html( '<div>QA_EDITOR_HTML</div>' ) +
				code( 'Left out' ),
			send: true,
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		await page
			.getByRole( 'button', { name: 'beehiiv', exact: true } )
			.first()
			.click();
		await expect(
			page.locator( '.beehiiv-post-settings-content' )
		).toBeVisible();

		await expect( page.locator( OMITTED_NOTICE ) ).toContainText(
			'1 block will be omitted from this newsletter.'
		);
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			1
		);
		await expect(
			canvas.locator( '.wp-block-code.beehiiv-omitted-block' )
		).toHaveCount( 1 );
		await expect( canvas.locator( '[data-type="core/html"]' ) ).toHaveCount(
			1
		);
		await expect(
			canvas.locator( '[data-type="core/html"].beehiiv-omitted-block' )
		).toHaveCount( 0 );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: keep unsupported elements out of the newsletter', () => {
	test( 'AC-009: script elements are removed and the rest of the HTML arrives unchanged', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			html(
				`${ STYLED }<script>window.qa = 1;</script><p>QA_AFTER_SCRIPT</p><script src="https://example.com/ad.js"></script>`
			)
		);
		expect( snippetHtml( blocks ) ).toEqual( [
			`${ STYLED }<p>QA_AFTER_SCRIPT</p>`,
		] );
		expect( JSON.stringify( blocks ) ).not.toMatch( /<script/i );
	} );

	test( 'AC-010: iframe elements are removed and the rest of the HTML arrives unchanged', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			html(
				`<p>QA_BEFORE_IFRAME</p><iframe src="https://example.com/embed" width="300" height="250"></iframe>${ STYLED }`
			)
		);
		expect( snippetHtml( blocks ) ).toEqual( [
			`<p>QA_BEFORE_IFRAME</p>${ STYLED }`,
		] );
		expect( JSON.stringify( blocks ) ).not.toMatch( /<iframe/i );
	} );

	test( 'AC-011: a Custom HTML block that holds only script or iframe elements produces no snippet', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			p( 'Before' ) +
				html( '<script>window.qa = 1;</script>' ) +
				html( '<iframe src="https://example.com/embed"></iframe>' ) +
				html(
					'<script src="https://example.com/a.js"></script>\n<iframe src="https://example.com/b"></iframe>'
				) +
				p( 'After' )
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph', 'paragraph' ] );
	} );

	test( 'AC-012: the editor shows a notice on a Custom HTML block holding a script or iframe, and none on a block without them', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			content:
				html(
					'<script>window.qa = 1;</script><p>QA_NOTICE_SCRIPT</p>'
				) +
				html( '<iframe src="https://example.com/embed"></iframe>' ) +
				html( '<div>QA_NOTICE_PLAIN</div>' ),
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const blocks = canvas.locator( '[data-type="core/html"]' );
		await expect( blocks ).toHaveCount( 3 );

		const message =
			'Script and iframe elements are not included in the newsletter.';
		await expect( canvas.locator( UNSUPPORTED_NOTICE ) ).toHaveCount( 2 );
		await expect(
			canvas.locator( UNSUPPORTED_NOTICE ).first()
		).toContainText( message );
		// Blocks 1 and 2 hold a script and an iframe. Block 3 holds neither.
		expect( await ownersOf( canvas, UNSUPPORTED_NOTICE ) ).toEqual( [
			0, 1,
		] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: send advertiser HTML to the newsletter only', () => {
	const VISIBLE = 'QA_SITE_VISIBLE';
	const HIDDEN = 'QA_NEWSLETTER_ONLY';

	/**
	 * Reads the front end, feed, excerpt and REST content of a published post.
	 *
	 * @param {import('@playwright/test').Page} page Playwright page.
	 * @param {string}                          id   Post ID.
	 * @param {string}                          link Post permalink.
	 * @return {Promise<Object>} The four channels as strings.
	 */
	async function channels( page, id, link ) {
		const front = await page.request.get( link );
		const feed = await page.request.get( '/?feed=rss2' );
		const rest = await page.request.get( `/wp-json/wp/v2/posts/${ id }` );
		const body = await rest.json();
		const excerpt = wpCli(
			`eval 'echo get_the_excerpt( get_post( ${ id } ) );'`
		);
		return {
			front: await front.text(),
			feed: await feed.text(),
			restContent: body.content.rendered,
			restExcerpt: body.excerpt.rendered,
			excerpt,
		};
	}

	test( 'AC-013: the sidebar of a Custom HTML block has a "Newsletter only" option, off by default', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( { content: html( '<div>QA_SIDEBAR</div>' ) } );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await canvas.locator( '[data-type="core/html"]' ).waitFor();
		await page.evaluate( () => {
			const store = window.wp.data.select( 'core/block-editor' );
			const block = store
				.getBlocks()
				.find( ( b ) => b.name === 'core/html' );
			window.wp.data
				.dispatch( 'core/block-editor' )
				.selectBlock( block.clientId );
		} );

		const toggle = page.getByRole( 'checkbox', {
			name: 'Newsletter only',
		} );
		// Open the settings sidebar on the Block tab and its Settings sub-tab,
		// where the option sits. Open it only if it is closed, so a click does not close it.
		const settingsButton = page
			.getByRole( 'button', { name: 'Settings', exact: true } )
			.first();
		if (
			( await settingsButton.getAttribute( 'aria-pressed' ) ) !== 'true'
		) {
			await settingsButton.click();
		}
		const blockTab = page.getByRole( 'tab', {
			name: 'Block',
			exact: true,
		} );
		if ( await blockTab.isVisible().catch( () => false ) ) {
			await blockTab.click();
		}
		const settingsTab = page.getByRole( 'tab', {
			name: 'Settings',
			exact: true,
		} );
		if ( await settingsTab.isVisible().catch( () => false ) ) {
			await settingsTab.click();
		}
		await expect( toggle ).toBeVisible();
		await expect( toggle ).not.toBeChecked();

		// Turning it on saves a per-block attribute (AC-019 data shape).
		await toggle.check();
		await expect( canvas.locator( NEWSLETTER_ONLY_LABEL ) ).toBeVisible();
		await saveDraft( page );
		const saved = wpEvalWith(
			{ id },
			'echo get_post_field( "post_content", $a["id"] );'
		);
		expect( saved ).toContain( '"beehiivNewsletterOnly":true' );
	} );

	test( 'AC-014: with the option off, the block shows on the site and also syncs as a snippet', async ( {
		page,
	} ) => {
		const { id, link, blocks } = await publish(
			page,
			p( 'Intro' ) + html( `<div>${ VISIBLE }</div>`, { only: false } )
		);
		expect( snippetHtml( blocks ) ).toEqual( [
			`<div>${ VISIBLE }</div>`,
		] );
		const seen = await channels( page, id, link );
		expect( seen.front ).toContain( VISIBLE );
	} );

	test( 'AC-015: with the option on, the block syncs as a snippet in its original position', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			p( 'Before' ) +
				html( `<div>${ HIDDEN }</div>`, { only: true } ) +
				p( 'After' )
		);
		expect( types( blocks ) ).toEqual( [
			'paragraph',
			'html',
			'paragraph',
		] );
		expect( blocks[ 1 ].html ).toBe( `<div>${ HIDDEN }</div>` );
	} );

	test( 'AC-016: with the option on, the block shows nothing on the WordPress front end', async ( {
		page,
	} ) => {
		const { id, link } = await publish(
			page,
			p( 'QA_PARAGRAPH_KEPT' ) +
				html( `<div class="qa-hidden">${ HIDDEN }</div>`, {
					only: true,
				} ),
			{ send: false }
		);
		const seen = await channels( page, id, link );
		expect( seen.front ).toContain( 'QA_PARAGRAPH_KEPT' );
		expect( seen.front ).not.toContain( HIDDEN );
		expect( seen.front ).not.toContain( 'qa-hidden' );
	} );

	test( 'AC-017: with the option on, the HTML is missing from the RSS feed, the excerpt and the REST rendered content', async ( {
		page,
	} ) => {
		const { id, link } = await publish(
			page,
			p( 'QA_PARAGRAPH_KEPT' ) +
				html( `<div>${ VISIBLE }</div>` ) +
				html( `<div>${ HIDDEN }</div>`, { only: true } ),
			{ send: false }
		);
		const seen = await channels( page, id, link );

		// The site-visible block reaches every channel, so each check is meaningful.
		expect( seen.feed ).toContain( VISIBLE );
		expect( seen.restContent ).toContain( VISIBLE );
		expect( seen.excerpt ).toContain( VISIBLE );

		expect( seen.feed ).not.toContain( HIDDEN );
		expect( seen.restContent ).not.toContain( HIDDEN );
		expect( seen.restExcerpt ).not.toContain( HIDDEN );
		expect( seen.excerpt ).not.toContain( HIDDEN );
	} );

	test( 'AC-018: in the editor a block with the option on shows a "Newsletter only" label and stays editable', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			content:
				html( '<div>QA_LABEL_ON</div>', { only: true } ) +
				html( '<div>QA_LABEL_OFF</div>' ),
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const blocks = canvas.locator( '[data-type="core/html"]' );
		await expect( blocks ).toHaveCount( 2 );

		await expect( canvas.locator( NEWSLETTER_ONLY_LABEL ) ).toHaveText(
			'Newsletter only'
		);
		// Only the first block has the option on.
		expect( await ownersOf( canvas, NEWSLETTER_ONLY_LABEL ) ).toEqual( [
			0,
		] );
		// BR-007: the block is still shown in full so it can be edited.
		await expect( blocks.nth( 0 ) ).toBeVisible();
	} );

	test( 'AC-019: the option is per block, so one post can hold site-visible and newsletter-only blocks', async ( {
		page,
	} ) => {
		const { id, link, blocks } = await publish(
			page,
			html( `<div>${ VISIBLE }</div>`, { only: false } ) +
				html( `<div>${ HIDDEN }</div>`, { only: true } ) +
				html( '<div>QA_DEFAULT_BLOCK</div>' )
		);
		expect( snippetHtml( blocks ) ).toEqual( [
			`<div>${ VISIBLE }</div>`,
			`<div>${ HIDDEN }</div>`,
			'<div>QA_DEFAULT_BLOCK</div>',
		] );
		const seen = await channels( page, id, link );
		expect( seen.front ).toContain( VISIBLE );
		expect( seen.front ).toContain( 'QA_DEFAULT_BLOCK' );
		expect( seen.front ).not.toContain( HIDDEN );
	} );

	test( 'AC-020: turning the option on for a published post removes the block from the site after the update, and turning it off shows it again', async ( {
		page,
	} ) => {
		const source = `<div>${ HIDDEN }</div>`;
		const { id, link, rest } = await publish(
			page,
			p( 'QA_PARAGRAPH_KEPT' ) + html( source ),
			{ send: false }
		);
		expect( ( await channels( page, id, link ) ).front ).toContain(
			HIDDEN
		);

		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			content: p( 'QA_PARAGRAPH_KEPT' ) + html( source, { only: true } ),
		} );
		const hidden = await channels( page, id, link );
		expect( hidden.front ).toContain( 'QA_PARAGRAPH_KEPT' );
		expect( hidden.front ).not.toContain( HIDDEN );
		expect( hidden.feed ).not.toContain( HIDDEN );

		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			content: p( 'QA_PARAGRAPH_KEPT' ) + html( source, { only: false } ),
		} );
		expect( ( await channels( page, id, link ) ).front ).toContain(
			HIDDEN
		);
	} );

	test( 'AC-021: a newsletter-only snippet carries no rule that hides it on the beehiiv web version or in the email', async ( {
		page,
	} ) => {
		const { blocks } = await publish(
			page,
			html( `<div>${ HIDDEN }</div>`, { only: true } )
		);
		const found = snippets( blocks );
		expect( found ).toHaveLength( 1 );
		// Only a type and the HTML: no visibility or display setting of any kind.
		expect( Object.keys( found[ 0 ] ).sort() ).toEqual( [
			'html',
			'type',
		] );
		expect( JSON.stringify( found[ 0 ] ) ).not.toMatch(
			/visib|hidden|hide|web_only|email_only|display/i
		);
		// And the option itself is not sent as a setting on the snippet.
		expect( JSON.stringify( found[ 0 ] ) ).not.toContain(
			'beehiivNewsletterOnly'
		);
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: verify the full flow on a test post', () => {
	test( 'AC-022: a post mixing a site-visible and a newsletter-only Custom HTML block behaves as agreed from the editor to the newsletter', async ( {
		page,
	} ) => {
		const visibleSource =
			'<div style="border:1px solid #ccc;padding:8px">QA22_VISIBLE_DIV</div>\n<table><tr><td>QA22_VISIBLE_TABLE</td></tr></table>';
		const linkedImage =
			'<a href="https://example.com/sponsor?utm_source=qa22"><img src="https://example.com/banner.png" alt="QA22_BANNER"></a>';
		const pixel =
			'<img src="https://example.com/pixel.gif?id=qa22-track" width="1" height="1" alt="">';
		const script = '<script>window.qa22 = true;</script>';
		const hiddenSource = `${ linkedImage }\n${ pixel }\n${ script }`;
		const hiddenSent = `${ linkedImage }\n${ pixel }`;

		const content =
			p( 'QA22_PARAGRAPH_ONE' ) +
			html( visibleSource, { only: false } ) +
			p( 'QA22_PARAGRAPH_TWO' ) +
			html( hiddenSource, { only: true } );

		const { id, link, blocks } = await publish( page, content );

		// Front end and feed: first block present, second absent.
		const front = await ( await page.request.get( link ) ).text();
		const feed = await ( await page.request.get( '/?feed=rss2' ) ).text();
		for ( const channel of [ front, feed ] ) {
			expect( channel ).toContain( 'QA22_PARAGRAPH_ONE' );
			expect( channel ).toContain( 'QA22_VISIBLE_DIV' );
			expect( channel ).toContain( 'QA22_VISIBLE_TABLE' );
			expect( channel ).toContain( 'QA22_PARAGRAPH_TWO' );
			expect( channel ).not.toContain( 'utm_source=qa22' );
			expect( channel ).not.toContain( 'qa22-track' );
			expect( channel ).not.toContain( 'QA22_BANNER' );
		}

		// beehiiv: same order, two separate snippets, script removed.
		expect( types( blocks ) ).toEqual( [
			'paragraph',
			'html',
			'paragraph',
			'html',
		] );
		expect( snippetHtml( blocks ) ).toEqual( [
			visibleSource,
			hiddenSent,
		] );

		// Editor: label and script notice on the second block only.
		await openPostEditor( page, id );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const editorBlocks = canvas.locator( '[data-type="core/html"]' );
		await expect( editorBlocks ).toHaveCount( 2 );
		await expect( canvas.locator( NEWSLETTER_ONLY_LABEL ) ).toHaveText(
			'Newsletter only'
		);
		await expect( canvas.locator( UNSUPPORTED_NOTICE ) ).toBeVisible();
		// The label and the notice belong to the second block only.
		expect( await ownersOf( canvas, NEWSLETTER_ONLY_LABEL ) ).toEqual( [
			1,
		] );
		expect( await ownersOf( canvas, UNSUPPORTED_NOTICE ) ).toEqual( [ 1 ] );
	} );
} );
