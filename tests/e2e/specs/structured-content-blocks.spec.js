const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/2-block-conversion/structured-content-blocks.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/BlockConverter.php -- block walk, columns routing.
 * - includes/Newsletter/Converters/ColumnsBlockConverter.php -- widths,
 *   vertical alignment, mobile stacking.
 * - includes/Newsletter/SupportedBlocks.php -- which blocks are converted.
 *
 * Each test publishes a post through the REST endpoint the block editor uses
 * (POST /wp/v2/posts/{id}, cookie + nonce), with "Send to Newsletter" on.
 * The test-only `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php
 * answers the beehiiv call and records it, so each test asserts on the exact
 * `blocks` payload the plugin sent. Nothing reaches the live API.
 */

const META_SEND = '_beehiiv_send_to_newsletter';
const PUBLICATION_ID = 'pub_qa_e2e_scb';
const TEMPLATE_ID = 'tpl_qa_e2e_scb';
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
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "post_qa_e2e_scb" ] ] ] );
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
 * Publishes a post with the given content and returns the blocks sent to beehiiv.
 *
 * @param {import('@playwright/test').Page} page    Playwright page.
 * @param {string}                          content Serialized block markup.
 * @return {Promise<Array>} The `blocks` array of the create-post request.
 */
async function convert( page, content ) {
	seed();
	const id = wpEvalWith(
		{ content },
		`$id = wp_insert_post( [ "post_type" => "post", "post_title" => "QA E2E structured blocks", "post_content" => $a["content"], "post_status" => "draft", "post_author" => 1 ] );
		update_post_meta( $id, "${ META_SEND }", "1" );
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
const btn = ( text ) =>
	`<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://example.com/go">${ text }</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`;
const group = ( inner ) =>
	`<!-- wp:group --><div class="wp-block-group">${ inner }</div><!-- /wp:group -->`;

/**
 * Builds one core/column block.
 *
 * @param {string} inner            Inner block markup.
 * @param {Object} [options]        Column options.
 * @param {string} [options.width]  Width attribute and flex-basis, e.g. "20%".
 * @param {string} [options.valign] verticalAlignment attribute value.
 * @return {string} Serialized column.
 */
function col( inner, { width, valign } = {} ) {
	const attrs = {};
	if ( width ) {
		attrs.width = width;
	}
	if ( valign ) {
		attrs.verticalAlignment = valign;
	}
	const json = Object.keys( attrs ).length
		? ` ${ JSON.stringify( attrs ) }`
		: '';
	const cls = valign
		? `wp-block-column is-vertically-aligned-${ valign }`
		: 'wp-block-column';
	const style = width ? ` style="flex-basis:${ width }"` : '';
	return `<!-- wp:column${ json } --><div class="${ cls }"${ style }>${ inner }</div><!-- /wp:column -->`;
}

/**
 * Builds one core/columns block.
 *
 * @param {string[]} cols              Serialized columns.
 * @param {Object}   [options]         Columns options.
 * @param {string}   [options.valign]  Block-level verticalAlignment.
 * @param {boolean}  [options.stacked] isStackedOnMobile value.
 * @return {string} Serialized columns block.
 */
function columns( cols, { valign, stacked } = {} ) {
	const attrs = {};
	if ( valign ) {
		attrs.verticalAlignment = valign;
	}
	if ( stacked !== undefined ) {
		attrs.isStackedOnMobile = stacked;
	}
	const json = Object.keys( attrs ).length
		? ` ${ JSON.stringify( attrs ) }`
		: '';
	const cls =
		'wp-block-columns' +
		( stacked === false ? ' is-not-stacked-on-mobile' : '' );
	return `<!-- wp:columns${ json } --><div class="${ cls }">${ cols.join(
		''
	) }</div><!-- /wp:columns -->`;
}

const types = ( blocks ) => blocks.map( ( b ) => b.type );
const columnsBlocks = ( blocks ) =>
	blocks.filter( ( b ) => b.type === 'columns' );

/**
 * Flattens the plain text of a list item's formatted text runs.
 *
 * @param {Object} item List item from the payload.
 * @return {string} Item text.
 */
const itemText = ( item ) =>
	typeof item === 'string'
		? item
		: ( item.formattedText || [] ).map( ( r ) => r.text ).join( '' );

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
test.describe( 'US-001: nested lists', () => {
	const nested = ( parentAttrs, childAttrs ) =>
		`<!-- wp:list${ parentAttrs } --><ul class="wp-block-list"><!-- wp:list-item --><li>Parent<!-- wp:list${ childAttrs } --><ul class="wp-block-list"><!-- wp:list-item --><li>Child<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>Grand</li><!-- /wp:list-item --></ul><!-- /wp:list --></li><!-- /wp:list-item --></ul><!-- /wp:list --></li><!-- /wp:list-item --></ul><!-- /wp:list -->`;

	test( 'AC-001: nested lists flatten into one list with indentation per level', async ( {
		page,
	} ) => {
		const blocks = await convert( page, nested( '', '' ) );
		const lists = blocks.filter( ( b ) => b.type === 'list' );
		expect( lists ).toHaveLength( 1 );
		const texts = lists[ 0 ].items.map( itemText );
		expect( texts ).toHaveLength( 3 );
		expect( texts[ 0 ] ).toBe( 'Parent' );
		const indent = ( s ) => s.match( /^(\s*-\s*)*/ )[ 0 ].length;
		expect( texts[ 1 ] ).toContain( 'Child' );
		expect( texts[ 2 ] ).toContain( 'Grand' );
		expect( indent( texts[ 1 ] ) ).toBeGreaterThan( indent( texts[ 0 ] ) );
		expect( indent( texts[ 2 ] ) ).toBeGreaterThan( indent( texts[ 1 ] ) );
	} );

	test( 'AC-002: parent text color cascades to children unless a child overrides it', async ( {
		page,
	} ) => {
		const cascade = await convert(
			page,
			nested( ' {"textColor":"vivid-red"}', '' )
		);
		const colors = cascade[ 0 ].items.map(
			( i ) => i.formattedText[ 0 ].text_color
		);
		expect( colors[ 0 ] ).toBeTruthy();
		expect( colors[ 1 ] ).toBe( colors[ 0 ] );
		expect( colors[ 2 ] ).toBe( colors[ 0 ] );

		const override = await convert(
			page,
			nested(
				' {"textColor":"vivid-red"}',
				' {"textColor":"luminous-vivid-amber"}'
			)
		);
		const oc = override[ 0 ].items.map(
			( i ) => i.formattedText[ 0 ].text_color
		);
		expect( oc[ 1 ] ).toBeTruthy();
		expect( oc[ 1 ] ).not.toBe( oc[ 0 ] );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: tables', () => {
	const table = ( extraAttrs = '', extraStyle = '' ) =>
		`<!-- wp:table${ extraAttrs } --><figure class="wp-block-table"><table${ extraStyle }><thead><tr><th class="has-text-align-left" data-align="left">Name</th><th class="has-text-align-right" data-align="right">Qty</th></tr></thead><tbody><tr><td>Apple</td><td class="has-text-align-right" data-align="right">3</td></tr></tbody><tfoot><tr><td>Total</td><td>3</td></tr></tfoot></table></figure><!-- /wp:table -->`;

	test( 'AC-003: header rows are marked and the footer is omitted', async ( {
		page,
	} ) => {
		const blocks = await convert( page, table() );
		const t = blocks.find( ( b ) => b.type === 'table' );
		expect( t ).toBeTruthy();
		expect( t.headerRow ).toBe( true );
		expect( t.rows[ 0 ].map( ( c ) => c.text ) ).toEqual( [
			'Name',
			'Qty',
		] );
		const all = JSON.stringify( t.rows );
		expect( all ).not.toContain( 'Total' );
		expect( t.rows ).toHaveLength( 2 );
	} );

	test( 'AC-004: table columns and cell alignment are preserved', async ( {
		page,
	} ) => {
		const blocks = await convert( page, table() );
		const t = blocks.find( ( b ) => b.type === 'table' );
		expect( t.rows.every( ( r ) => r.length === 2 ) ).toBe( true );
		expect( t.rows[ 0 ][ 0 ].alignment ).toBe( 'left' );
		expect( t.rows[ 0 ][ 1 ].alignment ).toBe( 'right' );
		expect( t.rows[ 1 ][ 1 ].alignment ).toBe( 'right' );
	} );

	test( 'AC-010: block background colors are applied to lists and tables', async ( {
		page,
	} ) => {
		const listBlocks = await convert(
			page,
			`<!-- wp:list {"style":{"color":{"background":"#ffeeaa"}}} --><ul class="wp-block-list has-background" style="background-color:#ffeeaa"><!-- wp:list-item --><li>Item</li><!-- /wp:list-item --></ul><!-- /wp:list -->`
		);
		const list = listBlocks.find( ( b ) => b.type === 'list' );
		expect( JSON.stringify( list ).toLowerCase() ).toContain( '#ffeeaa' );

		const tableBlocks = await convert(
			page,
			table(
				' {"style":{"color":{"background":"#eeeeee"}}}',
				' class="has-background" style="background-color:#eeeeee"'
			)
		);
		const t = tableBlocks.find( ( b ) => b.type === 'table' );
		expect( t ).toBeTruthy();
		expect( JSON.stringify( t ).toLowerCase() ).toContain( '#eeeeee' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: media-text', () => {
	const mediaText = ( {
		position = 'left',
		width = 30,
		type = 'image',
		src = IMG,
		inner = p( 'Side text' ),
	} = {} ) => {
		const attrs = JSON.stringify( {
			mediaPosition: position,
			mediaId: 1,
			mediaType: type,
			mediaWidth: width,
		} );
		let mediaInner = '';
		if ( src && type === 'video' ) {
			mediaInner = `<video controls src="${ src }"></video>`;
		} else if ( src ) {
			mediaInner = `<img src="${ src }" alt="a"/>`;
		}
		const media = `<figure class="wp-block-media-text__media">${ mediaInner }</figure>`;
		const content = `<div class="wp-block-media-text__content">${ inner }</div>`;
		const right = position === 'right';
		return `<!-- wp:media-text ${ attrs } --><div class="wp-block-media-text${
			right ? ' has-media-on-the-right' : ''
		} is-stacked-on-mobile" style="grid-template-columns:${
			right ? `auto ${ width }%` : `${ width }% auto`
		}">${
			right ? content + media : media + content
		}</div><!-- /wp:media-text -->`;
	};

	test( 'AC-005: media-text converts to two columns with the configured widths', async ( {
		page,
	} ) => {
		const blocks = await convert( page, mediaText( { width: 30 } ) );
		const cols = columnsBlocks( blocks );
		expect( cols ).toHaveLength( 1 );
		expect( cols[ 0 ].columns ).toHaveLength( 2 );
		expect( cols[ 0 ].columns.map( ( c ) => c.width ) ).toEqual( [
			30, 70,
		] );
		expect( cols[ 0 ].columns[ 0 ].blocks[ 0 ].type ).toBe( 'image' );
		expect( cols[ 0 ].columns[ 1 ].blocks[ 0 ].type ).toBe( 'paragraph' );
	} );

	test( 'AC-006: media on the right reorders the columns', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			mediaText( { position: 'right', width: 30 } )
		);
		const cols = columnsBlocks( blocks )[ 0 ].columns;
		expect( cols[ 0 ].blocks[ 0 ].type ).toBe( 'paragraph' );
		expect( cols[ 1 ].blocks[ 0 ].type ).toBe( 'image' );
		expect( cols.map( ( c ) => c.width ) ).toEqual( [ 70, 30 ] );
	} );

	test( 'AC-007: video media-text is omitted entirely', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			mediaText( { type: 'video', src: 'https://example.com/v.mp4' } ) +
				p( 'After video' )
		);
		expect( types( blocks ) ).toEqual( [ 'paragraph' ] );
		expect( JSON.stringify( blocks ) ).not.toContain( 'Side text' );
	} );

	test( 'AC-009: media-text with no valid image URL is omitted', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			mediaText( { src: '' } ) + p( 'After media-text' )
		);
		expect( columnsBlocks( blocks ) ).toHaveLength( 0 );
		expect( JSON.stringify( blocks ) ).not.toContain( 'Side text' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: columns block widths, alignment and stacking', () => {
	test( 'AC-008: columns keep widths, vertical alignment and the stacking setting', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			columns(
				[
					col( p( 'A' ), { width: '30%', valign: 'bottom' } ),
					col( p( 'B' ), { width: '70%', valign: 'top' } ),
				],
				{ stacked: false }
			)
		);
		const block = columnsBlocks( blocks )[ 0 ];
		expect( block.columns.map( ( c ) => c.width ) ).toEqual( [ 30, 70 ] );
		expect( block.columns.map( ( c ) => c.verticalAlign ) ).toEqual( [
			'bottom',
			'top',
		] );
		expect( block.stackOnMobile ).toBe( false );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-006: top-level Columns blocks', () => {
	test( 'AC-011: a top-level Columns block becomes one columns block, one column each, in order', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			columns( [ col( p( 'One' ) ), col( p( 'Two' ) ) ] )
		);
		expect( types( blocks ) ).toEqual( [ 'columns' ] );
		const cols = blocks[ 0 ].columns;
		expect( cols ).toHaveLength( 2 );
		expect( cols[ 0 ].blocks[ 0 ].plaintext ).toBe( 'One' );
		expect( cols[ 1 ].blocks[ 0 ].plaintext ).toBe( 'Two' );
	} );

	test( 'AC-012: a column keeps its inner blocks in order and omits blocks beehiiv does not accept', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			columns( [
				col( h( 'Title' ) + p( 'Body' ) + btn( 'Go' ) ),
				col( group( p( 'Inside group' ) ) ),
				col( p( 'Kept' ) ),
			] )
		);
		const cols = columnsBlocks( blocks )[ 0 ].columns;
		expect( types( cols[ 0 ].blocks ) ).toEqual( [
			'heading',
			'paragraph',
			'button',
		] );
		// The column holding only an unsupported group is omitted.
		expect( cols ).toHaveLength( 2 );
		expect( JSON.stringify( blocks ) ).not.toContain( 'Inside group' );
		expect( cols[ 1 ].blocks[ 0 ].plaintext ).toBe( 'Kept' );
	} );

	test( 'AC-013: percent widths become whole percents and a missing width stays unset', async ( {
		page,
	} ) => {
		const withWidths = await convert(
			page,
			columns( [
				col( p( 'A' ), { width: '33.33%' } ),
				col( p( 'B' ), { width: '66.67%' } ),
			] )
		);
		expect(
			columnsBlocks( withWidths )[ 0 ].columns.map( ( c ) => c.width )
		).toEqual( [ 33, 67 ] );

		const noWidths = await convert(
			page,
			columns( [ col( p( 'A' ) ), col( p( 'B' ) ) ] )
		);
		for ( const c of columnsBlocks( noWidths )[ 0 ].columns ) {
			expect( c ).not.toHaveProperty( 'width' );
		}
	} );

	test( "AC-014: px widths become each column's share of the row, and one missing width clears the row", async ( {
		page,
	} ) => {
		const px = await convert(
			page,
			columns( [
				col( p( 'A' ), { width: '100px' } ),
				col( p( 'B' ), { width: '300px' } ),
			] )
		);
		expect(
			columnsBlocks( px )[ 0 ].columns.map( ( c ) => c.width )
		).toEqual( [ 25, 75 ] );

		const rem = await convert(
			page,
			columns( [
				col( p( 'A' ), { width: '10rem' } ),
				col( p( 'B' ), { width: '10rem' } ),
				col( p( 'C' ), { width: '20rem' } ),
			] )
		);
		expect(
			columnsBlocks( rem )[ 0 ].columns.map( ( c ) => c.width )
		).toEqual( [ 25, 25, 50 ] );

		const partial = await convert(
			page,
			columns( [ col( p( 'A' ), { width: '100px' } ), col( p( 'B' ) ) ] )
		);
		for ( const c of columnsBlocks( partial )[ 0 ].columns ) {
			expect( c ).not.toHaveProperty( 'width' );
		}
	} );

	test( 'AC-015: vertical alignment from the column or the Columns block becomes top, middle or bottom', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			columns(
				[
					col( p( 'A' ), { valign: 'center' } ),
					col( p( 'B' ), { valign: 'bottom' } ),
					col( p( 'C' ) ),
				],
				{ valign: 'top' }
			)
		);
		expect(
			columnsBlocks( blocks )[ 0 ].columns.map( ( c ) => c.verticalAlign )
		).toEqual( [ 'middle', 'bottom', 'top' ] );
	} );

	test( 'AC-016: columns stack on mobile by default and not when the block opts out', async ( {
		page,
	} ) => {
		const def = await convert(
			page,
			columns( [ col( p( 'A' ) ), col( p( 'B' ) ) ] )
		);
		expect( columnsBlocks( def )[ 0 ].stackOnMobile ).toBe( true );

		const off = await convert(
			page,
			columns( [ col( p( 'A' ) ), col( p( 'B' ) ) ], { stacked: false } )
		);
		expect( columnsBlocks( off )[ 0 ].stackOnMobile ).toBe( false );
	} );

	test( 'AC-017: a Columns block with more than 3 columns is omitted', async ( {
		page,
	} ) => {
		const four = await convert(
			page,
			p( 'Before' ) +
				columns( [
					col( p( 'A' ) ),
					col( p( 'B' ) ),
					col( p( 'C' ) ),
					col( p( 'D' ) ),
				] ) +
				p( 'After' )
		);
		expect( columnsBlocks( four ) ).toHaveLength( 0 );
		expect( four.map( ( b ) => b.plaintext ) ).toEqual( [
			'Before',
			'After',
		] );

		// Control: exactly 3 columns still converts to one columns block.
		const three = await convert(
			page,
			columns( [ col( p( 'A' ) ), col( p( 'B' ) ), col( p( 'C' ) ) ] )
		);
		expect( columnsBlocks( three ) ).toHaveLength( 1 );
		expect( columnsBlocks( three )[ 0 ].columns ).toHaveLength( 3 );
	} );

	test( 'AC-018: a Columns block nested in a column becomes top-level blocks', async ( {
		page,
	} ) => {
		const nested = columns( [ col( p( 'N1' ) ), col( p( 'N2' ) ) ] );
		const blocks = await convert(
			page,
			columns( [ col( p( 'Outer A' ) + nested ), col( p( 'Outer B' ) ) ] )
		);
		const cols = columnsBlocks( blocks );
		expect( cols ).toHaveLength( 1 );
		expect( JSON.stringify( cols[ 0 ].columns ) ).not.toContain( 'N1' );
		expect( JSON.stringify( cols[ 0 ].columns ) ).not.toContain(
			'"columns":[{"blocks":[{"type":"paragraph","plaintext":"N1"'
		);
		const top = blocks.slice( 1 );
		expect( top.map( ( b ) => b.plaintext ) ).toEqual( [ 'N1', 'N2' ] );
	} );

	test( 'AC-019: a 3-column layout with an image, heading plus paragraph, and a button converts to one columns block', async ( {
		page,
	} ) => {
		const blocks = await convert(
			page,
			columns( [
				col( img() ),
				col( h( 'Head' ) + p( 'Para' ) ),
				col( btn( 'Click' ) ),
			] )
		);
		expect( types( blocks ) ).toEqual( [ 'columns' ] );
		const cols = blocks[ 0 ].columns;
		expect( cols ).toHaveLength( 3 );
		expect( types( cols[ 0 ].blocks ) ).toEqual( [ 'image' ] );
		expect( types( cols[ 1 ].blocks ) ).toEqual( [
			'heading',
			'paragraph',
		] );
		expect( types( cols[ 2 ].blocks ) ).toEqual( [ 'button' ] );
	} );
} );
