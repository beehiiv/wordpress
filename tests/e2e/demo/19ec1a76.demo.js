// @demo-acs AC-001 AC-005 AC-009 AC-011 AC-012 AC-013 AC-016 AC-018 AC-019 AC-021 AC-022 AC-026 AC-032
/**
 * One-take demo for intake 19ec1a76: subscriber gating with the Gated Content
 * block (PRD-05.4.01) and its site defaults (PRD-08.1.03).
 *
 * Run through the record-intake-demo skill (config: playwright.demo.config.js).
 * State is arranged with wp-cli. Every action in the video goes through the
 * real UI. beehiiv's own servers are blocked while recording, so the form
 * itself does not load. The submit is the same message beehiiv's form sends
 * when a reader subscribes (type, form ID, beehiiv origin), and the captions
 * say so.
 */
const path = require( 'path' );
const os = require( 'os' );
const fs = require( 'fs' );
const kit = require( './kit' );
const { test, expect, wp, installOverlay, caption, glideClick, point } = kit;

const FORM_ID = 'demo-form-7ba8db0b';
const COOKIE = 'beehiiv_gate_unlocked';
const STATE = path.join( os.tmpdir(), 'demo-19ec1a76-auth.json' );
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
		delete_option( "beehiiv_settings" );
	` );
}

function createPost( title ) {
	const body =
		'<!-- wp:paragraph --><p>Monday: the story opens here, and every reader can see these first lines.</p><!-- /wp:paragraph -->';
	const out = php( `
		$id = wp_insert_post( wp_slash( array(
			"post_type" => "post",
			"post_title" => ${ JSON.stringify( title ) },
			"post_status" => "draft",
			"post_content" => ${ JSON.stringify( body ) },
		) ) );
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	ids.push( id );
	return id;
}

async function dismissGuide( page ) {
	const close = page.locator( '.components-modal__header button' ).first();
	if ( await close.isVisible().catch( () => false ) ) {
		await close.click();
	}
}

async function submitForm( page, formId ) {
	await page.evaluate( ( id ) => {
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: 'https://subscribe-forms.beehiiv.com',
				data: {
					type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
					externalEmbedId: id,
				},
			} )
		);
	}, formId );
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

test( 'Subscriber gating: full walkthrough', async ( { page } ) => {
	await installOverlay( page );
	// beehiiv's servers are not reachable from a recording, and no real
	// subscription should be made. The form area stays empty.
	await page.route( '**/subscribe-forms.beehiiv.com/**', ( route ) =>
		route.abort()
	);

	// 1. Settings: site-wide defaults -----------------------------------------
	await page.goto( '/wp-admin/admin.php?page=beehiiv' );
	await expect(
		page.getByRole( 'heading', { name: 'Subscriber gating' } )
	).toBeVisible();
	await caption(
		page,
		'Subscriber gating · demo of the beehiiv plugin build',
		3000
	);
	await caption(
		page,
		'1/4 · Settings: a new "Subscriber gating" section holds the site defaults',
		1500
	);
	await point(
		page,
		page.getByRole( 'heading', { name: 'Subscriber gating' } ),
		1500
	);
	const formField = page.locator( '#beehiiv_gate_form_id' );
	await glideClick( page, formField );
	await formField.fill( FORM_ID );
	await caption(
		page,
		'Set the default subscribe form once. Gated blocks use it unless they have their own form ID.',
		3500
	);
	const headline = page.locator( '#beehiiv_gate_headline' );
	await glideClick( page, headline );
	await headline.fill( 'Subscribe to keep reading' );
	const text = page.locator( '#beehiiv_gate_text' );
	await glideClick( page, text );
	await text.fill( 'Enter your email to unlock the full story.' );
	await caption(
		page,
		'The headline and text are optional. Leave them blank to show only the form.',
		3500
	);
	const days = page.locator( '#beehiiv_gate_cookie_days' );
	await glideClick( page, days );
	await days.fill( '30' );
	await caption(
		page,
		'A reader stays unlocked for 30 days after subscribing (1 to 365)',
		3000
	);
	await glideClick(
		page,
		page.getByRole( 'button', { name: 'Save settings' } )
	);
	await expect( page.locator( '#beehiiv_gate_form_id' ) ).toHaveValue(
		FORM_ID
	);
	await caption( page, 'Saved', 1500 );

	// 2. Editor: add the Gated Content block --------------------------------
	const postId = createPost( 'The weekly briefing' );
	await caption( page, '2/4 · Post editor: add the Gated Content block', 0 );
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 20000,
	} );
	await dismissGuide( page );
	const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
	await caption(
		page,
		'The post starts with one paragraph that everyone will see',
		2500
	);
	await glideClick(
		page,
		page.getByRole( 'button', { name: /Block Inserter/i } ).first()
	);
	const search = page.getByPlaceholder( /^Search/ ).first();
	await search.fill( 'Gated Content' );
	const item = page
		.getByRole( 'option', { name: /beehiiv Gated Content/ } )
		.first();
	await expect( item ).toBeVisible();
	await caption(
		page,
		'The block is in the beehiiv category of the inserter (AC-001)',
		2500
	);
	await glideClick( page, item );
	const divider = canvas.locator(
		'[data-type="beehiiv/gated-content-divider"]'
	);
	await expect( divider ).toBeVisible( { timeout: 15000 } );
	await caption(
		page,
		'A new block starts with a paragraph, a divider, and a paragraph. Move the divider like any block (AC-005)',
		4500
	);
	const gated = canvas.locator( '[data-type="beehiiv/gated-content"]' );
	const lastParagraph = gated
		.locator( '[data-type="core/paragraph"]' )
		.last();
	await lastParagraph.click();
	await page.keyboard.type(
		'Tuesday to Friday: the full briefing, only for subscribers.'
	);
	await caption(
		page,
		'Above the divider is the preview. Below it is gated content (AC-009)',
		3500
	);
	await page.getByRole( 'button', { name: 'Close block inserter' } ).click();
	await gated.click( { position: { x: 4, y: 4 } } );
	const formControl = page.getByLabel( 'Subscribe form ID' );
	await expect( formControl ).toBeVisible();
	await point( page, formControl, 1200 );
	await caption(
		page,
		`The sidebar shows the default form ID from settings: ${ FORM_ID } (AC-032)`,
		4000
	);
	await expect( formControl ).toHaveAttribute( 'placeholder', FORM_ID );
	await expect( page.getByLabel( 'Headline' ) ).toBeVisible();
	await caption(
		page,
		'Each block can override the headline and text, and choose the card colors',
		3500
	);
	await page.evaluate( async () => {
		const { dispatch } = window.wp.data;
		dispatch( 'core/editor' ).editPost( { status: 'publish' } );
		await dispatch( 'core/editor' ).savePost();
	} );
	await page.waitForFunction(
		() =>
			window.wp.data.select( 'core/editor' ).getCurrentPost().status ===
			'publish',
		null,
		{ timeout: 20000 }
	);
	await caption( page, 'Publish', 1500 );

	// 3. Reader view: locked until the reader subscribes -----------------------
	await caption( page, '3/4 · A reader opens the post (logged out)', 1500 );
	await page.goto( '/wp-login.php?action=logout' );
	await page.getByRole( 'link', { name: 'log out' } ).click();
	await page.goto( `/?p=${ postId }` );
	await expect( page.getByText( 'Monday: the story opens' ) ).toBeVisible();
	await caption( page, 'The preview shows normally (AC-011)', 2500 );
	const gate = page.locator( '[data-beehiiv-gate]' );
	const locked = page.locator( '.beehiiv-gated-content__locked' );
	await expect( gate ).toBeVisible();
	await expect( locked ).toHaveAttribute( 'inert', '' );
	await point( page, page.locator( '.beehiiv-gated-content__card' ), 1500 );
	await caption(
		page,
		'The gated content is blurred and faded, and the subscribe card sits over it (AC-012, AC-013)',
		4500
	);
	await caption(
		page,
		'In production the beehiiv form appears in this card. The recording blocks beehiiv, so only the card is shown.',
		4500
	);
	await caption(
		page,
		'The locked text cannot be selected, focused, or read by screen readers until it unlocks (AC-026)',
		4000
	);

	// 4. Subscribe: unlock, remember, and skip for logged-in users --------------
	await caption(
		page,
		'4/4 · The reader subscribes. beehiiv\'s form sends a "submitted" message with its form ID (AC-016)',
		1500
	);
	await submitForm( page, 'some-other-form' );
	await page.waitForTimeout( 800 );
	await expect( locked ).toHaveAttribute( 'inert', '' );
	await caption(
		page,
		'A different form on the page does not unlock it',
		3500
	);
	await submitForm( page, FORM_ID );
	await expect( locked ).not.toHaveAttribute( 'inert', /.*/ );
	await expect( page.getByText( 'Tuesday to Friday' ) ).toBeVisible();
	await caption(
		page,
		"This gate's own form unlocks the content in place, with no page reload (AC-018)",
		4000
	);
	const cookies = await page.context().cookies();
	expect( cookies.some( ( c ) => c.name === COOKIE ) ).toBe( true );
	await caption(
		page,
		'One cookie remembers the reader for 30 days (AC-019)',
		3500
	);
	await page.reload();
	await expect( page.getByText( 'Tuesday to Friday' ) ).toBeVisible();
	await expect( page.locator( '.beehiiv-gated-content__card' ) ).toBeHidden();
	await caption(
		page,
		'A returning reader sees the full post with no gate (AC-021)',
		4000
	);

	await page.context().clearCookies();
	await page.goto( '/wp-login.php' );
	await kit.loginAsAdmin( page );
	await page.goto( `/?p=${ postId }` );
	await expect( page.getByText( 'Tuesday to Friday' ) ).toBeVisible();
	await expect( page.locator( '[data-beehiiv-gate]' ) ).toHaveCount( 0 );
	await caption(
		page,
		'Logged-in users, such as editors and admins, always see the full post (AC-022)',
		4500
	);
	await caption( page, 'End of walkthrough', 2500 );
} );
