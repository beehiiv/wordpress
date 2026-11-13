const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const {
	wpCli,
	ensurePluginActive,
	ensurePrettyPermalinks,
	ensureActiveTheme,
} = require( '../utils/wp-cli' );

/**
 * PRDs: requirements/05-custom-blocks/4-gated-content-block/gated-content-block.prd.md
 * (PRD-05.4.01) and requirements/08-admin-interface/1-settings-page/subscriber-gate-defaults.prd.md.
 *
 * The beehiiv form itself is an iframe from subscribe-forms.beehiiv.com, which
 * a test must not depend on. The loader request is aborted, and a form submit
 * is simulated with the same message the real form sends: a message event with
 * the beehiiv origin, the submitted type and the form ID.
 */

const SUBMITTED = 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED';
const COOKIE = 'beehiiv_gate_unlocked';
const createdPostIds = [];

function gatedBlock( formId, body ) {
	return (
		`<!-- wp:beehiiv/gated-content {"formId":"${ formId }","headline":"Join to read","text":"Subscribe for the rest."} -->` +
		`<!-- wp:paragraph --><p>${ body }-PREVIEW</p><!-- /wp:paragraph -->` +
		'<!-- wp:beehiiv/gated-content-divider /-->' +
		`<!-- wp:paragraph --><p>${ body }-LOCKED</p><!-- /wp:paragraph -->` +
		'<!-- /wp:beehiiv/gated-content -->'
	);
}

function createPost( title, content, postType = 'post' ) {
	const b64 = Buffer.from( content ).toString( 'base64' );
	const id = wpCli(
		`eval 'echo wp_insert_post( array( "post_title" => "${ title }", "post_type" => "${ postType }", "post_status" => "publish", "post_content" => base64_decode( "${ b64 }" ) ) );'`
	);
	createdPostIds.push( id );
	return id;
}

async function submit( page, formId ) {
	await page.evaluate(
		( { type, id } ) => {
			window.dispatchEvent(
				new MessageEvent( 'message', {
					origin: 'https://subscribe-forms.beehiiv.com',
					data: { type, externalEmbedId: id },
				} )
			);
		},
		{ type: SUBMITTED, id: formId }
	);
}

test.describe( 'Gated Content block', () => {
	test.beforeAll( () => {
		ensurePluginActive();
		ensurePrettyPermalinks();
		ensureActiveTheme();
	} );

	test.afterAll( () => {
		createdPostIds.forEach( ( id ) =>
			wpCli( `post delete ${ id } --force` )
		);
	} );

	test.beforeEach( async ( { page } ) => {
		await page.route( '**/subscribe-forms.beehiiv.com/**', ( route ) =>
			route.abort()
		);
	} );

	test( 'logged-out reader sees the preview, a locked gate and the form loader (AC-009, AC-012, AC-026 to AC-028)', async ( {
		page,
	} ) => {
		const id = createPost( 'Gate basic', gatedBlock( 'form_e2e_1', 'A' ) );
		await page.goto( `/?p=${ id }` );

		await expect( page.getByText( 'A-PREVIEW' ) ).toBeVisible();
		const locked = page.locator( '.beehiiv-gated-content__locked' );
		await expect( locked ).toHaveAttribute( 'inert', '' );
		await expect( locked ).toHaveAttribute( 'aria-hidden', 'true' );
		await expect( page.getByText( 'Join to read' ) ).toBeVisible();
		await expect(
			page.locator( 'script[data-beehiiv-form="form_e2e_1"]' )
		).toHaveCount( 1 );
	} );

	test( 'submitting the gate form unlocks the content and sets the cookie (AC-016, AC-018, AC-019)', async ( {
		page,
	} ) => {
		const id = createPost( 'Gate unlock', gatedBlock( 'form_e2e_2', 'B' ) );
		await page.goto( `/?p=${ id }` );
		await submit( page, 'form_e2e_2' );

		const locked = page.locator( '.beehiiv-gated-content__locked' );
		await expect( locked ).not.toHaveAttribute( 'inert', /.*/ );
		await expect( locked ).not.toHaveAttribute( 'aria-hidden', /.*/ );
		await expect(
			page.locator( '.beehiiv-gated-content__card' )
		).toBeHidden();
		const cookies = await page.context().cookies();
		expect( cookies.some( ( c ) => c.name === COOKIE ) ).toBe( true );
	} );

	test( 'a different form does not unlock the gate (AC-017)', async ( {
		page,
	} ) => {
		const id = createPost(
			'Gate other form',
			gatedBlock( 'form_e2e_3', 'C' )
		);
		await page.goto( `/?p=${ id }` );
		await submit( page, 'some_other_form' );

		await expect(
			page.locator( '.beehiiv-gated-content__locked' )
		).toHaveAttribute( 'inert', '' );
	} );

	test( 'a returning reader sees no gate and no form loader (AC-021, AC-023)', async ( {
		page,
		context,
	} ) => {
		const id = createPost(
			'Gate returning',
			gatedBlock( 'form_e2e_4', 'D' )
		);
		const { hostname } = new URL(
			process.env.WP_BASE_URL || 'http://localhost:8891'
		);
		await context.addCookies( [
			{ name: COOKIE, value: '1', domain: hostname, path: '/' },
		] );
		await page.goto( `/?p=${ id }` );

		await expect( page.getByText( 'D-LOCKED' ) ).toBeVisible();
		await expect(
			page.locator( '.beehiiv-gated-content__card' )
		).toBeHidden();
		await expect( page.locator( 'script[data-beehiiv-form]' ) ).toHaveCount(
			0
		);
		await expect(
			page.locator( '.beehiiv-gated-content__locked' )
		).not.toHaveAttribute( 'inert', /.*/ );
	} );

	test( 'every gate on a page unlocks together (AC-025, BR-006)', async ( {
		page,
	} ) => {
		const id = createPost(
			'Gate two',
			gatedBlock( 'form_e2e_5', 'E' ) + gatedBlock( 'form_e2e_6', 'F' )
		);
		await page.goto( `/?p=${ id }` );
		await expect(
			page.locator( '.beehiiv-gated-content__gate' )
		).toHaveCount( 2 );

		await submit( page, 'form_e2e_6' );

		await expect(
			page.locator( '.beehiiv-gated-content__gate.is-unlocked' )
		).toHaveCount( 2 );
	} );

	test( 'a logged-in administrator sees the full content with no gate (AC-022)', async ( {
		page,
	} ) => {
		const id = createPost( 'Gate admin', gatedBlock( 'form_e2e_7', 'G' ) );
		await loginAsAdmin( page );
		await page.goto( `/?p=${ id }` );

		await expect( page.getByText( 'G-LOCKED' ) ).toBeVisible();
		await expect(
			page.locator( '.beehiiv-gated-content__gate' )
		).toHaveCount( 0 );
	} );

	test( 'after unlock, focus moves to the content and a status message is announced (AC-018, AC-029)', async ( {
		page,
	} ) => {
		const id = createPost( 'Gate focus', gatedBlock( 'form_e2e_8', 'H' ) );
		await page.goto( `/?p=${ id }` );
		await submit( page, 'form_e2e_8' );

		const locked = page.locator( '.beehiiv-gated-content__locked' );
		await expect( locked ).toBeFocused();

		const status = page.locator( '[role="status"]' );
		await expect( status ).toHaveText( 'Content unlocked.' );
		await expect( status ).toHaveCount( 1 );

		// The content can be selected and reached again.
		expect(
			await locked.evaluate(
				( el ) => window.getComputedStyle( el ).userSelect
			)
		).not.toBe( 'none' );
		expect(
			await locked.evaluate(
				( el ) => window.getComputedStyle( el ).pointerEvents
			)
		).not.toBe( 'none' );
	} );

	test( 'long gated content is limited in height and fades out at the bottom (AC-013)', async ( {
		page,
	} ) => {
		const paragraphs = Array.from(
			{ length: 40 },
			( _, i ) =>
				`<!-- wp:paragraph --><p>Long gated paragraph ${ i } with enough words to wrap across the content column on a desktop screen.</p><!-- /wp:paragraph -->`
		).join( '' );
		const content =
			'<!-- wp:beehiiv/gated-content {"formId":"form_e2e_9"} -->' +
			'<!-- wp:paragraph --><p>I-PREVIEW</p><!-- /wp:paragraph -->' +
			'<!-- wp:beehiiv/gated-content-divider /-->' +
			paragraphs +
			'<!-- /wp:beehiiv/gated-content -->';
		const id = createPost( 'Gate long', content );
		await page.goto( `/?p=${ id }` );

		const locked = page.locator( '.beehiiv-gated-content__locked' );
		const box = await locked.evaluate( ( el ) => ( {
			maxHeight: window.getComputedStyle( el ).maxHeight,
			filter: window.getComputedStyle( el ).filter,
			overflow: window.getComputedStyle( el ).overflow,
			client: el.clientHeight,
			scroll: el.scrollHeight,
			fade: window.getComputedStyle( el, '::after' ).backgroundImage,
			fadeHeight: window.getComputedStyle( el, '::after' ).height,
		} ) );

		// 30rem at the default 16px root size, and the content is taller.
		expect( box.maxHeight ).toBe( '480px' );
		expect( box.overflow ).toBe( 'hidden' );
		expect( box.client ).toBeLessThanOrEqual( 480 );
		expect( box.scroll ).toBeGreaterThan( 480 );
		expect( box.filter ).toContain( 'blur' );
		expect( box.fade ).toContain( 'linear-gradient' );
		// The fade covers the bottom 60%.
		expect( parseFloat( box.fadeHeight ) ).toBeCloseTo(
			box.client * 0.6,
			0
		);

		// After unlock the limit and the fade go away.
		await submit( page, 'form_e2e_9' );
		await expect( locked ).toHaveCSS( 'max-height', 'none' );
		await expect( locked ).toHaveCSS( 'filter', 'none' );
	} );

	test( 'a logged-in editor sees the full content with no gate (AC-022)', async ( {
		page,
	} ) => {
		const id = createPost(
			'Gate editor',
			gatedBlock( 'form_e2e_10', 'J' )
		);
		wpCli(
			'user create gate_editor gate_editor@example.test --role=editor --user_pass=gate-editor-pass'
		);
		try {
			await loginAs( page, 'gate_editor', 'gate-editor-pass' );
			await page.goto( `/?p=${ id }` );

			await expect( page.getByText( 'J-LOCKED' ) ).toBeVisible();
			await expect(
				page.locator( '.beehiiv-gated-content__gate' )
			).toHaveCount( 0 );
		} finally {
			wpCli( 'user delete gate_editor --yes' );
		}
	} );

	test( 'the gate works on a page, not only on posts (AC-024)', async ( {
		page,
	} ) => {
		const id = createPost(
			'Gate page',
			gatedBlock( 'form_e2e_11', 'K' ),
			'page'
		);
		await page.goto( `/?page_id=${ id }` );

		await expect( page.getByText( 'K-PREVIEW' ) ).toBeVisible();
		await expect(
			page.locator( '.beehiiv-gated-content__locked' )
		).toHaveAttribute( 'inert', '' );

		await submit( page, 'form_e2e_11' );
		await expect(
			page.locator( '.beehiiv-gated-content__locked' )
		).not.toHaveAttribute( 'inert', /.*/ );
	} );

	test( 'a cached copy of the page still opens for a returning reader (AC-023)', async ( {
		page,
		context,
	} ) => {
		const id = createPost( 'Gate cache', gatedBlock( 'form_e2e_12', 'L' ) );
		const url = `/?p=${ id }`;

		// A full-page cache stores the HTML built for a visitor with no cookie.
		const cached = await ( await page.request.get( url ) ).text();
		expect( cached ).toContain( 'data-beehiiv-gate' );
		expect( cached ).toContain( 'L-LOCKED' );

		// A returning reader gets that same cached HTML with the unlock cookie.
		const { hostname } = new URL(
			process.env.WP_BASE_URL || 'http://localhost:8891'
		);
		await context.addCookies( [
			{ name: COOKIE, value: '1', domain: hostname, path: '/' },
		] );
		await page.route( `**${ url }`, ( route ) =>
			route.fulfill( {
				status: 200,
				contentType: 'text/html; charset=UTF-8',
				body: cached,
			} )
		);
		await page.goto( url );

		await expect(
			page.locator( '.beehiiv-gated-content__gate.is-unlocked' )
		).toHaveCount( 1 );
		await expect(
			page.locator( '.beehiiv-gated-content__locked' )
		).not.toHaveAttribute( 'inert', /.*/ );
		await expect( page.getByText( 'L-LOCKED' ) ).toBeVisible();
	} );
} );
