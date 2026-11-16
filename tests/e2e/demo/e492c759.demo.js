// @demo-acs AC-001 AC-007 AC-009 AC-010 AC-011 AC-012 AC-016 AC-019 AC-020 AC-021 AC-022
/**
 * One-take demo for intake e492c759: Publication selector in the post sidebar
 * (PRD-06.8.02). Built for the commit the intake recorded (e01e8fb).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js). State is arranged with the same
 * tests-environment seams the QA spec uses (tests/e2e/plugins/beehiiv-options.php).
 * Every action in the video goes through the real UI; wp-cli only seeds data
 * and reads back which beehiiv publication each API call targeted.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const kit = require( './kit' );
const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const PUB_A = { id: 'pub_qa_alpha', name: 'Alpha Daily' };
const PUB_B = { id: 'pub_qa_beta', name: 'Beta Weekly' };
const PUB_C = { id: 'pub_qa_gamma', name: 'Gamma Monthly' };
const TEMPLATES = {
	[ PUB_A.id ]: [
		{ id: 'tpl_a1', name: 'Alpha Standard' },
		{ id: 'tpl_a2', name: 'Alpha Promo' },
	],
	[ PUB_B.id ]: [
		{ id: 'tpl_b1', name: 'Beta Classic' },
		{ id: 'tpl_b2', name: 'Beta Digest' },
	],
};
const CREATED = { [ PUB_A.id ]: 'bh_alpha_new', [ PUB_B.id ]: 'bh_beta_new' };
const PUB_SELECT = '.beehiiv-newsletter-publication select';
const TPL_SELECT = '.beehiiv-newsletter-template select';
const STATE = path.join( os.tmpdir(), 'demo-e492c759-auth.json' );
const ids = [];

const b64 = ( v ) => Buffer.from( JSON.stringify( v ) ).toString( 'base64' );
const J = ( v ) => `json_decode( base64_decode( "${ b64( v ) }" ), true )`;
const php = ( code ) =>
	wp.wpCli(
		`eval 'eval( base64_decode( "${ Buffer.from( code ).toString(
			'base64'
		) }" ) );'`
	);

function seed() {
	let code = `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		beehiiv_e2e_seed_publications( ${ J( [ PUB_A, PUB_B ] ) } );
		update_option( "beehiiv_settings", ${ J( {
			publication_id: PUB_A.id,
			post_template_id: 'tpl_a1',
		} ) } );
		beehiiv_e2e_mock_http( "/publications?", [ "body" => [ "data" => ${ J( [
			PUB_A,
			PUB_B,
			PUB_C,
		] ) } ] ] );
	`;
	for ( const [ pub, tpls ] of Object.entries( TEMPLATES ) ) {
		code += `beehiiv_e2e_seed_post_templates( "${ pub }", ${ J(
			tpls
		) } );`;
		code += `beehiiv_e2e_mock_http( "/publications/${ pub }/posts", [ "body" => [ "data" => [ "id" => "${ CREATED[ pub ] }" ] ] ] );`;
	}
	php( code + 'beehiiv_e2e_start_http_log();' );
}

function createPost( title, meta = {} ) {
	const out = php( `
		$id = wp_insert_post( wp_slash( ${ J( {
			post_type: 'post',
			post_title: title,
			post_status: 'draft',
			post_content:
				'<!-- wp:paragraph --><p>This week in newsletters.</p><!-- /wp:paragraph -->',
		} ) } ) );
		foreach ( ${ J( {
			_beehiiv_send_to_newsletter: '1',
			...meta,
		} ) } as $k => $v ) { update_post_meta( $id, $k, $v ); }
		beehiiv_e2e_start_http_log();
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	ids.push( id );
	return id;
}

/** Which beehiiv publications received a create-post call since the log started. */
function createdIn() {
	const out = php(
		'echo "JSON=" . wp_json_encode( beehiiv_e2e_get_http_log() );'
	);
	return JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) )
		.filter(
			( e ) =>
				e.method === 'POST' &&
				/\/publications\/[^/]+\/posts/.test( e.url )
		)
		.map( ( e ) => /\/publications\/([^/]+)\/posts/.exec( e.url )[ 1 ] );
}

async function openEditor( page, id ) {
	await kit.openPostEditor( page, id );
	const content = page.locator( '.beehiiv-post-settings-content' );
	if ( ! ( await content.isVisible().catch( () => false ) ) ) {
		await page
			.getByRole( 'button', { name: 'beehiiv', exact: true } )
			.first()
			.click();
	}
	await expect( content ).toBeVisible();
	await expect( page.locator( TPL_SELECT ) ).toBeVisible( {
		timeout: 15000,
	} );
}

async function publishPost( page ) {
	await page.evaluate( async () => {
		const { dispatch } = window.wp.data;
		dispatch( 'core/editor' ).editPost( { status: 'publish' } );
		await dispatch( 'core/editor' ).savePost();
	} );
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
	fs.rmSync( STATE, { force: true } );
} );

test( 'Publication selector in the post sidebar: full walkthrough', async ( {
	page,
} ) => {
	await installOverlay( page );

	// 1. Settings: the site-wide default publication ---------------------------
	await page.goto( '/wp-admin/admin.php?page=beehiiv' );
	const defaultSelect = page.locator( '#beehiiv_publication_id' );
	await expect( defaultSelect ).toBeVisible();
	await caption(
		page,
		'Publication selector in the post sidebar · beehiiv plugin build e01e8fb',
		3500
	);
	await caption(
		page,
		'1/4 · Settings: the old "Publication" field is now "Default publication" (AC-020)',
		1200
	);
	await point(
		page,
		page.locator( 'label[for="beehiiv_publication_id"]' ),
		2500
	);
	await caption(
		page,
		'It is preselected on every new post. Admins no longer switch it before each send.',
		1200
	);
	await point( page, defaultSelect, 3000 );
	await caption(
		page,
		'Refresh publications reloads the list from beehiiv, and keeps the current selection (AC-021)',
		1200
	);
	await glideClick(
		page,
		page.getByRole( 'button', { name: 'Refresh publications' } )
	);
	await expect(
		page.getByText( 'Publications updated from beehiiv.' )
	).toBeVisible();
	await expect(
		defaultSelect.locator( 'option', { hasText: PUB_C.name } )
	).toHaveCount( 1 );
	await caption(
		page,
		'A new publication, "Gamma Monthly", now appears in the list.',
		3000
	);

	// 2. Post editor: choose the publication and template per post ---------------
	const postId = createPost( 'This week in newsletters' );
	await caption(
		page,
		'2/4 · Post editor, beehiiv panel: each post has its own Publication selector (AC-001)',
		0
	);
	await openEditor( page, postId );
	await caption(
		page,
		'2/4 · The Publication selector sits directly above Post template (AC-001)',
		2500
	);
	const pub = page.locator( PUB_SELECT );
	await point( page, pub, 1500 );
	await caption(
		page,
		'It starts on the default publication, "Alpha Daily", with its default template (AC-010)',
		3500
	);
	await point( page, page.locator( TPL_SELECT ), 1500 );
	await caption(
		page,
		"Post template lists only Alpha Daily's templates (AC-007)",
		3000
	);

	await caption( page, 'Switch this post to "Beta Weekly"', 1000 );
	await glideClick( page, pub );
	await pub.selectOption( PUB_B.id );
	await expect(
		page.locator( `${ TPL_SELECT } option`, { hasText: 'Beta Digest' } )
	).toHaveCount( 1, { timeout: 15000 } );
	await caption(
		page,
		"The template is cleared and the list now shows Beta Weekly's templates. The editor must pick one (AC-009, AC-011)",
		4500
	);
	await glideClick( page, page.locator( TPL_SELECT ) );
	await page.locator( TPL_SELECT ).selectOption( 'tpl_b2' );
	await caption( page, 'Pick "Beta Digest"', 2500 );

	// 3. Publish: the newsletter goes to the chosen publication ------------------
	await caption( page, '3/4 · Publish the post', 1500 );
	await publishPost( page );
	await expect( pub ).toBeDisabled( { timeout: 20000 } );
	const targets = createdIn();
	expect( targets ).toEqual( [ PUB_B.id ] );
	await caption(
		page,
		`beehiiv receives the newsletter in "Beta Weekly" only. Call made: POST /publications/${ targets[ 0 ] }/posts (AC-012)`,
		5000
	);
	await caption(
		page,
		'Once the post is linked to beehiiv, the publication and template are locked (AC-016)',
		3500
	);
	await point( page, pub, 1500 );

	// 4. Fallback when a stored publication is no longer connected ---------------
	const staleId = createPost( 'Post from a removed publication', {
		_beehiiv_publication_id: 'pub_qa_removed',
	} );
	await caption( page, '4/4 · A post whose publication was disconnected', 0 );
	await openEditor( page, staleId );
	const notice = page.getByText(
		/no longer connected.*default publication "Alpha Daily"/
	);
	await expect( notice ).toBeVisible();
	await point( page, notice, 1500 );
	await caption(
		page,
		'The editor sees a notice. The send falls back to the default publication, "Alpha Daily" (AC-019)',
		4500
	);
	await publishPost( page );
	await expect( pub ).toBeDisabled( { timeout: 20000 } );
	const refresh = page
		.locator( '.beehiiv-newsletter-publication' )
		.getByRole( 'button', { name: 'Refresh publications' } );
	await expect( refresh ).toBeDisabled();
	await point( page, refresh, 800 );
	await caption(
		page,
		'Refresh publications is unavailable once the post is linked (AC-022)',
		3500
	);
	await caption( page, 'End of walkthrough', 2500 );
} );
