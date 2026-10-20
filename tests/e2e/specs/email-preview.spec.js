const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { openPostEditor, saveDraft } = require( '../utils/editor' );
const {
	wpCli,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/06-editor-integration/5-newsletter-preview/email-preview.prd.md
 *
 * Behavioral coverage, authored independently of the build session from the
 * PRD's Acceptance Criteria + Technical Approach and the current code at the
 * PLAN/EXECUTION file lists:
 * - includes/REST/EmailPreviewController.php  (POST /beehiiv/v1/email-preview)
 * - includes/Newsletter/EmailPreview.php      (eligibility, sync, retry, errors)
 * - includes/API/Resources/Posts.php          (get_email_content)
 * - src/js/editor/post-settings/components/email-preview.js
 * - src/js/editor/post-settings/index.js      ("Email preview" PanelBody)
 *
 * beehiiv is never contacted: every outbound call is answered by the
 * test-only mu-plugin (tests/e2e/plugins/beehiiv-options.php, tests env
 * only), which logs each mocked request so specs can assert exactly what the
 * plugin sent to beehiiv. The rendered email returned by the mock is a fixed
 * fixture, so this spec proves the plugin passes beehiiv's HTML through and
 * sandboxes it. It cannot prove beehiiv really renders a draft's email
 * (PRD AC-004 / Q-001), which needs a live beehiiv account.
 */

const PUB = 'pub_e2e';
const TPL = 'tpl_e2e';
const DRAFT_ID = 'post_preview_e2e';
const LINKED_ID = 'post_linked_e2e';
const ORIGIN = 'http://localhost:8891';

const AUTHOR = { login: 'qa_e2e_prev_author', role: 'author' };
const CONTRIB = { login: 'qa_e2e_prev_contrib', role: 'contributor' };
const TEST_USER_PASS = 'qa-e2e-preview-pass';

const CONTENT =
	'<!-- wp:paragraph --><p>Hello from the beehiiv email preview spec.</p><!-- /wp:paragraph -->';

const EMAIL_HTML =
	'<html><body>' +
	'<div id="e2e-header">E2E HEADER</div>' +
	'<h1>Hello preview</h1>' +
	'<script>window.parent.postMessage("e2e-script-ran","*");</script>' +
	'<img src="x" onerror="window.parent.postMessage(\'e2e-handler-ran\',\'*\')">' +
	`<a id="plain" href="${ ORIGIN }/e2e-link-target">plain link</a> ` +
	`<a id="blank" target="_blank" href="${ ORIGIN }/e2e-blank-target">blank link</a>` +
	`<form id="f" method="post" action="${ ORIGIN }/e2e-form-target"><button id="go" type="submit">Go</button></form>` +
	'<div id="e2e-footer">E2E FOOTER</div>' +
	'</body></html>';

const NEWSLETTER_META_KEYS = [
	'_beehiiv_post_id',
	'_beehiiv_post_state',
	'_beehiiv_scheduled_at',
	'_beehiiv_send_to_newsletter',
	'_beehiiv_send_to_newsletter_date',
	'_beehiiv_newsletter_error',
	'_beehiiv_newsletter_error_type',
];

const createdPostIds = [];

// ---------------------------------------------------------------------------
// wp-cli helpers (tests-cli container only)
// ---------------------------------------------------------------------------

const b64 = ( value ) => Buffer.from( value ).toString( 'base64' );

/**
 * Runs arbitrary PHP inside the tests environment and returns its output.
 *
 * @param {string} code PHP code.
 * @return {string} Output.
 */
function php( code ) {
	return wpCli( `eval 'eval( base64_decode( "${ b64( code ) }" ) );'` );
}

/**
 * Runs PHP that echoes JSON and returns it parsed.
 *
 * @param {string} code PHP code.
 * @return {*} Parsed value.
 */
function phpJson( code ) {
	const out = php( code );
	const start = out.search( /[\[{"]|null|true|false|\d/ );
	return JSON.parse( out.slice( start ) );
}

/**
 * Passes a JS value into PHP as a decoded array expression.
 *
 * @param {*} value Value.
 * @return {string} PHP expression.
 */
const phpArg = ( value ) =>
	`json_decode( base64_decode( "${ b64(
		JSON.stringify( value )
	) }" ), true )`;

/**
 * Connected, Send-API-enabled, publication + template configured.
 *
 * @param {Object} overrides Optional overrides.
 */
function seedReadyState( overrides = {} ) {
	const settings = {
		publication_id: PUB,
		post_template_id: TPL,
		...( overrides.settings || {} ),
	};
	const permissions = overrides.permissions || {
		posts: [ 'read', 'write' ],
	};
	php( `
		beehiiv_e2e_reset_all();
		${ overrides.connected === false ? '' : 'beehiiv_e2e_seed_connection();' }
		beehiiv_e2e_mock_permissions( ${ phpArg( permissions ) } );
		remove_all_filters( "sanitize_option_beehiiv_settings" );
		update_option( "beehiiv_settings", ${ phpArg( settings ) } );
	` );
}

/**
 * Registers beehiiv post endpoint mocks (create, update, read-with-email).
 *
 * @param {Object} root0        Mock overrides.
 * @param {Object} root0.create Create-post response.
 * @param {Object} root0.update Update-post response.
 * @param {Object} root0.email  Read-post (rendered email) response.
 */
function mockBeehiivPosts( {
	create = { status: 201, body: { data: { id: DRAFT_ID } } },
	update = { status: 200, body: { data: { id: DRAFT_ID } } },
	email = {
		status: 200,
		body: {
			data: { id: DRAFT_ID, content: { free: { email: EMAIL_HTML } } },
		},
	},
} = {} ) {
	const mocks = {
		create_post: {
			pattern: '#/publications/[^/]+/posts(\\?|$)#',
			method: 'POST',
			...create,
		},
		update_post: {
			pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
			method: 'PATCH',
			...update,
		},
		get_email: {
			pattern: '#/publications/[^/]+/posts/[^/?]+\\?#',
			method: 'GET',
			...email,
		},
	};
	php( `
		foreach ( ${ phpArg( mocks ) } as $key => $mock ) {
			beehiiv_e2e_mock_http( $key, $mock );
		}
	` );
}

const emailBody = ( html ) => ( {
	status: 200,
	body: { data: { id: DRAFT_ID, content: { free: { email: html } } } },
} );

/** @return {Array} Mocked outbound requests the plugin made since the last reset. */
function readHttpLog() {
	return phpJson(
		'echo wp_json_encode( array_values( (array) get_option( "beehiiv_e2e_http_log", [] ) ) );'
	);
}

const beehiivPostCalls = ( log ) =>
	log.filter( ( entry ) => entry.mock !== '/workspaces/permissions' );

const callLabels = ( log ) =>
	beehiivPostCalls( log ).map( ( c ) => `${ c.method } ${ c.mock }` );

/**
 * Creates a post directly in the DB (no REST, so no newsletter sync runs).
 *
 * @param {Object} root0         Post args.
 * @param {string} root0.title   Title.
 * @param {string} root0.content Content.
 * @param {string} root0.status  Status.
 * @param {number} root0.author  Author ID.
 * @param {Object} root0.meta    Post meta.
 * @return {number} Post ID.
 */
function createPost( {
	title = 'Email preview post',
	content = CONTENT,
	status = 'draft',
	author = 1,
	meta = { _beehiiv_send_to_newsletter: '1' },
} = {} ) {
	const id = Number(
		php( `
			$id = wp_insert_post( [
				"post_title"   => ${ phpArg( title ) },
				"post_content" => ${ phpArg( content ) },
				"post_status"  => "${ status }",
				"post_author"  => ${ Number( author ) },
				"post_type"    => "post",
			], true );
			if ( is_wp_error( $id ) ) { echo 0; return; }
			foreach ( ${ phpArg( meta ) } as $key => $value ) {
				update_post_meta( $id, $key, $value );
			}
			echo $id;
		` ).match( /\d+\s*$/ )[ 0 ]
	);
	expect( id ).toBeGreaterThan( 0 );
	createdPostIds.push( id );
	return id;
}

/**
 * @param {number} postId Post ID.
 * @return {Object} Newsletter-related post meta.
 */
function readNewsletterMeta( postId ) {
	return phpJson( `
		$out = [];
		foreach ( ${ phpArg( NEWSLETTER_META_KEYS ) } as $key ) {
			$out[ $key ] = get_post_meta( ${ postId }, $key, true );
		}
		echo wp_json_encode( $out );
	` );
}

const isoUtc = ( offsetSeconds ) =>
	new Date( Date.now() + offsetSeconds * 1000 )
		.toISOString()
		.replace( /\.\d{3}Z$/, 'Z' );

const futureLinkedMeta = () => ( {
	_beehiiv_send_to_newsletter: '1',
	_beehiiv_post_id: LINKED_ID,
	_beehiiv_scheduled_at: isoUtc( 2 * 86400 ),
} );

// ---------------------------------------------------------------------------
// Editor helpers
// ---------------------------------------------------------------------------

/**
 * Opens the editor and the beehiiv sidebar panel.
 *
 * @param {import('@playwright/test').Page} page   Page.
 * @param {number}                          postId Post ID.
 */
async function openBeehiivPanel( page, postId ) {
	await openPostEditor( page, postId );
	const toggle = page
		.getByRole( 'button', { name: 'beehiiv', exact: true } )
		.first();
	await toggle.waitFor( { state: 'visible', timeout: 15000 } );
	const pressed =
		( await toggle.getAttribute( 'aria-expanded' ) ) === 'true' ||
		( await toggle.getAttribute( 'aria-pressed' ) ) === 'true';
	if ( ! pressed ) {
		await toggle.click();
	}
	await expect(
		page.locator( '.beehiiv-post-settings-content' )
	).toBeVisible();
}

const previewButton = ( page ) =>
	page.getByRole( 'button', { name: 'Preview email', exact: true } );
const modal = ( page ) => page.getByRole( 'dialog', { name: 'Email preview' } );
const emailFrame = ( page ) => modal( page ).locator( 'iframe' );

/**
 * @param {import('@playwright/test').Page} page Page.
 */
async function expectPreviewDisabled( page ) {
	await expect( previewButton( page ) ).toBeVisible();
	const ariaDisabled =
		await previewButton( page ).getAttribute( 'aria-disabled' );
	const disabled = await previewButton( page ).isDisabled();
	expect( ariaDisabled === 'true' || disabled ).toBe( true );
}

/**
 * Clicks Preview and resolves with the REST response.
 *
 * @param {import('@playwright/test').Page} page Page.
 * @return {Promise<import('@playwright/test').Response>} Response.
 */
async function clickPreview( page ) {
	const response = page.waitForResponse(
		( res ) =>
			res.url().includes( 'beehiiv/v1/email-preview' ) &&
			res.request().method() === 'POST',
		{ timeout: 40000 }
	);
	await previewButton( page ).click();
	return response;
}

/**
 * POSTs straight to the REST route with the logged-in user's REST nonce,
 * bypassing the editor UI entirely. Call on any block editor page.
 *
 * @param {import('@playwright/test').Page} page   Page.
 * @param {number}                          postId Post ID.
 * @return {Promise<{status:number, body:*}>} Result.
 */
async function restPreview( page, postId ) {
	return page.evaluate( async ( id ) => {
		const res = await window.fetch(
			window.wpApiSettings.root + 'beehiiv/v1/email-preview',
			{
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': window.wpApiSettings.nonce,
				},
				body: JSON.stringify( { post_id: id } ),
			}
		);
		let body = null;
		try {
			body = await res.json();
		} catch {}
		return { status: res.status, body };
	}, postId );
}

// ---------------------------------------------------------------------------

test.describe( 'Email Preview (PRD-06.5 email-preview)', () => {
	test.describe.configure( { timeout: 120 * 1000 } );

	test.beforeAll( () => {
		ensurePluginActive();
		ensurePrettyPermalinks();
		php( `
			foreach ( ${ phpArg( [ AUTHOR, CONTRIB ] ) } as $u ) {
				$existing = get_user_by( "login", $u["login"] );
				if ( $existing ) {
					wp_set_password( "${ TEST_USER_PASS }", $existing->ID );
					$existing->set_role( $u["role"] );
				} else {
					wp_insert_user( [
						"user_login" => $u["login"],
						"user_pass"  => "${ TEST_USER_PASS }",
						"user_email" => $u["login"] . "@example.com",
						"role"       => $u["role"],
					] );
				}
			}
		` );
	} );

	test.beforeEach( () => {
		seedReadyState();
		mockBeehiivPosts();
	} );

	test.afterAll( () => {
		php( `
			require_once ABSPATH . "wp-admin/includes/user.php";
			foreach ( ${ phpArg( createdPostIds ) } as $id ) {
				delete_post_meta( $id, "_beehiiv_post_id" );
				wp_delete_post( $id, true );
			}
			foreach ( ${ phpArg( [ AUTHOR.login, CONTRIB.login ] ) } as $login ) {
				$u = get_user_by( "login", $login );
				if ( $u ) { wp_delete_user( $u->ID, 1 ); }
			}
			beehiiv_e2e_reset_all();
			delete_option( "beehiiv_settings" );
		` );
	} );

	// ----- US-001 -----------------------------------------------------------

	test( 'AC-001: "Preview email" shows in the beehiiv panel only while "Send to newsletter" is on, never on the posts list', async ( {
		page,
	} ) => {
		const optedIn = createPost( { title: 'AC-001 opted in' } );
		const optedOut = createPost( {
			title: 'AC-001 opted out',
			meta: { _beehiiv_send_to_newsletter: '' },
		} );
		await loginAsAdmin( page );

		await openBeehiivPanel( page, optedIn );
		await expect( previewButton( page ) ).toBeVisible();

		await openBeehiivPanel( page, optedOut );
		await expect( previewButton( page ) ).toHaveCount( 0 );

		// Turning the toggle on in the editor makes it appear; off removes it.
		const toggle = page.getByLabel( 'Send to newsletter' ).first();
		await toggle.check();
		await expect( previewButton( page ) ).toBeVisible();
		await toggle.uncheck();
		await expect( previewButton( page ) ).toHaveCount( 0 );

		await page.goto( '/wp-admin/edit.php' );
		await expect( page.locator( `#post-${ optedIn }` ) ).toBeVisible();
		await page.locator( `#post-${ optedIn }` ).hover();
		await expect( page.locator( '#wpbody' ) ).not.toContainText(
			/preview email/i
		);
	} );

	test( 'AC-002: clicking Preview opens the WordPress modal showing the beehiiv-rendered email', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-002 post' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		const res = await clickPreview( page );
		expect( res.status() ).toBe( 200 );
		await expect( modal( page ) ).toBeVisible();
		await expect(
			modal( page ).locator( '.components-modal__header' )
		).toContainText( 'Email preview' );

		const frame = page.frameLocator(
			'.beehiiv-email-preview__modal iframe'
		);
		await expect( frame.locator( 'h1' ) ).toHaveText( 'Hello preview' );
	} );

	test( 'AC-003: each click syncs the draft from the saved post (create first, update after) before fetching the email', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-003 saved title' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		php( 'beehiiv_e2e_clear_http_log();' );

		// First click: no linked draft -> create, then fetch.
		await clickPreview( page );
		await expect( emailFrame( page ) ).toBeVisible();
		let calls = beehiivPostCalls( readHttpLog() );
		expect( callLabels( readHttpLog() ) ).toEqual( [
			'POST create_post',
			'GET get_email',
		] );
		expect( calls[ 0 ].body.title ).toBe( 'AC-003 saved title' );
		expect( calls[ 0 ].body.status ).toBe( 'draft' );
		expect( calls[ 1 ].url ).toContain( `/posts/${ DRAFT_ID }` );
		expect( calls[ 1 ].url ).toContain( 'free_email_content' );

		const meta = readNewsletterMeta( postId );
		expect( meta._beehiiv_post_id ).toBe( DRAFT_ID );
		expect( meta._beehiiv_post_state ).toBe( 'draft' );

		// Edit and save the title, reopen: update (not create) with the new title.
		await page.keyboard.press( 'Escape' );
		await expect( modal( page ) ).toHaveCount( 0 );
		const title = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.locator( '.editor-post-title__input, [aria-label="Add title"]' )
			.first();
		await title.click();
		await page.keyboard.press( 'End' );
		await page.keyboard.type( ' EDITED' );
		await saveDraft( page );

		php( 'beehiiv_e2e_clear_http_log();' );
		await clickPreview( page );
		await expect( emailFrame( page ) ).toBeVisible();
		calls = beehiivPostCalls( readHttpLog() );
		expect( callLabels( readHttpLog() ) ).toEqual( [
			'PATCH update_post',
			'GET get_email',
		] );
		expect( calls[ 0 ].url ).toContain( `/posts/${ DRAFT_ID }` );
		expect( JSON.stringify( calls[ 0 ].body ) ).toContain(
			'AC-003 saved title EDITED'
		);
	} );

	test( 'AC-005: the email renders in a sandboxed frame with scripts disabled; links and forms do nothing', async ( {
		page,
		context,
	} ) => {
		const postId = createPost( { title: 'AC-005 post' } );
		await loginAsAdmin( page );
		await page.addInitScript( () => {
			window.__e2eMessages = [];
			window.addEventListener( 'message', ( e ) => {
				window.__e2eMessages.push( e.data );
			} );
		} );
		await openBeehiivPanel( page, postId );

		const requested = [];
		page.on( 'request', ( req ) => {
			if ( /e2e-(link|blank|form)-target/.test( req.url() ) ) {
				requested.push( req.url() );
			}
		} );
		let popups = 0;
		context.on( 'page', () => {
			popups++;
		} );

		await clickPreview( page );
		await expect( emailFrame( page ) ).toBeVisible();

		// Sandbox attribute present and empty: no allow-scripts, no allow-forms,
		// no allow-popups, no allow-same-origin, no allow-top-navigation.
		const sandbox = await emailFrame( page ).getAttribute( 'sandbox' );
		expect( sandbox ).not.toBeNull();
		expect( sandbox.trim() ).toBe( '' );

		const frame = page.frameLocator(
			'.beehiiv-email-preview__modal iframe'
		);
		await expect( frame.locator( '#e2e-header' ) ).toBeVisible();

		// Links are inert (pointer-events: none), so force the clicks through.
		await frame.locator( '#blank' ).click( { force: true } );
		await frame.locator( '#go' ).click( { force: true } );
		// Plain link last: a same-frame navigation would replace the email.
		await frame.locator( '#plain' ).click( { force: true, timeout: 5000 } );
		await page.waitForTimeout( 1500 );

		const messages = await page.evaluate( () => window.__e2eMessages );
		expect( messages ).toEqual( [] );
		expect( requested ).toEqual( [] );
		expect( popups ).toBe( 0 );
		// The editor and modal are still intact.
		await expect( modal( page ) ).toBeVisible();
		await expect( frame.locator( '#e2e-header' ) ).toBeVisible();
	} );

	test( 'AC-006: loading state while syncing/fetching; a still-preparing email is retried briefly, then reported as try-again', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-006 post' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		// Loading state: beehiiv answers after 3s.
		mockBeehiivPosts( {
			email: { ...emailBody( EMAIL_HTML ), delay_ms: 3000 },
		} );
		const done = clickPreview( page );
		await expect( modal( page ) ).toContainText(
			'Preparing your email preview'
		);
		await expect( emailFrame( page ) ).toHaveCount( 0 );
		await done;
		await expect( emailFrame( page ) ).toBeVisible();
		await expect( modal( page ) ).not.toContainText(
			'Preparing your email preview'
		);
		await page.keyboard.press( 'Escape' );

		// Still preparing: empty email on every fetch.
		mockBeehiivPosts( { email: emailBody( '' ) } );
		php( 'beehiiv_e2e_clear_http_log();' );
		await previewButton( page ).click();
		await expect( modal( page ) ).toContainText(
			'Preparing your email preview'
		);
		await expect( modal( page ) ).toContainText( 'still preparing', {
			timeout: 30000,
		} );
		await expect(
			modal( page ).getByRole( 'button', { name: 'Try again' } )
		).toBeVisible();
		const fetches = readHttpLog().filter( ( e ) => e.mock === 'get_email' );
		expect( fetches.length ).toBeGreaterThan( 1 );
	} );

	test( 'AC-007: closing the modal changes nothing on the post; reopening runs a fresh sync and fetch', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-007 post' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await clickPreview( page );
		await expect( emailFrame( page ) ).toBeVisible();

		const before = readNewsletterMeta( postId );
		const postWrites = [];
		page.on( 'request', ( req ) => {
			if (
				new RegExp( `/wp/v2/posts/${ postId }(\\?|$|/)` ).test(
					req.url()
				) &&
				req.method() !== 'GET'
			) {
				postWrites.push( req.url() );
			}
		} );

		await modal( page ).getByRole( 'button', { name: 'Close' } ).click();
		await expect( modal( page ) ).toHaveCount( 0 );
		await page.waitForTimeout( 1000 );
		expect( readNewsletterMeta( postId ) ).toEqual( before );
		expect( postWrites ).toEqual( [] );
		expect(
			php( `echo get_post_field( "post_title", ${ postId } );` )
		).toBe( 'AC-007 post' );

		php( 'beehiiv_e2e_clear_http_log();' );
		await clickPreview( page );
		await expect( emailFrame( page ) ).toBeVisible();
		expect( callLabels( readHttpLog() ) ).toEqual( [
			'PATCH update_post',
			'GET get_email',
		] );
	} );

	// ----- US-002 -----------------------------------------------------------

	test( 'AC-008: Preview is disabled with a save note while unsaved or saving; the plugin never saves', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-008 original title' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		await expect( previewButton( page ) ).toBeEnabled();

		const postWrites = [];
		page.on( 'request', ( req ) => {
			if (
				new RegExp( `/wp/v2/posts/${ postId }(\\?|$|/)` ).test(
					req.url()
				) &&
				req.method() !== 'GET'
			) {
				postWrites.push( req.url() );
			}
		} );
		let previewRequests = 0;
		page.on( 'request', ( req ) => {
			if ( req.url().includes( 'beehiiv/v1/email-preview' ) ) {
				previewRequests++;
			}
		} );
		php( 'beehiiv_e2e_clear_http_log();' );

		const title = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.locator( '.editor-post-title__input, [aria-label="Add title"]' )
			.first();
		await title.click();
		await page.keyboard.press( 'End' );
		await page.keyboard.type( ' EDITED' );

		await expect( page.locator( '.beehiiv-email-preview' ) ).toContainText(
			'Save the post'
		);
		await expectPreviewDisabled( page );
		await previewButton( page ).click( { force: true } );
		await page.waitForTimeout( 1500 );

		expect( previewRequests ).toBe( 0 );
		expect( postWrites ).toEqual( [] );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );
		await expect( modal( page ) ).toHaveCount( 0 );
		expect(
			php( `echo get_post_field( "post_title", ${ postId } );` )
		).toBe( 'AC-008 original title' );

		// Saving: hold the post save request and sample both states together.
		await page.route(
			new RegExp( `/wp/v2/posts/${ postId }(\\?|$)` ),
			async ( route ) => {
				if ( route.request().method() === 'GET' ) {
					return route.continue();
				}
				await new Promise( ( r ) => setTimeout( r, 4000 ) );
				return route.continue();
			}
		);
		await page.evaluate( () => {
			window.wp.data.dispatch( 'core/editor' ).savePost();
		} );
		await expect
			.poll(
				() =>
					page.evaluate( () =>
						window.wp.data.select( 'core/editor' ).isSavingPost()
					),
				{ timeout: 5000 }
			)
			.toBe( true );
		const sample = await page.evaluate( () => {
			const btn = [
				...document.querySelectorAll( '.beehiiv-email-preview button' ),
			].find( ( b ) => b.textContent.trim() === 'Preview email' );
			return {
				saving: window.wp.data.select( 'core/editor' ).isSavingPost(),
				disabled:
					!! btn &&
					( btn.disabled ||
						btn.getAttribute( 'aria-disabled' ) === 'true' ),
			};
		} );
		expect( sample.saving ).toBe( true );
		expect( sample.disabled ).toBe( true );

		// After the save completes, Preview is available again.
		await expect
			.poll(
				() =>
					page.evaluate( () =>
						window.wp.data.select( 'core/editor' ).isSavingPost()
					),
				{ timeout: 15000 }
			)
			.toBe( false );
		await expect( previewButton( page ) ).toBeEnabled();
	} );

	test( 'AC-009: not offered when beehiiv is not ready, with the same readiness message as the toggle; the server refuses too', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-009 post' } );
		const cases = [
			{
				name: 'not connected',
				seed: { connected: false },
				message: 'Connect your beehiiv account',
				code: 'beehiiv_not_connected',
			},
			{
				name: 'no Send API',
				seed: { permissions: { posts: [ 'read' ] } },
				message: "doesn't have access to send newsletters",
				code: 'beehiiv_preview_plan',
			},
			{
				name: 'no publication',
				seed: { settings: { publication_id: '' } },
				message: 'Choose a publication in',
				code: 'beehiiv_missing_publication',
			},
			{
				name: 'no template',
				seed: { settings: { post_template_id: '' } },
				message: 'Choose a default post template in',
				code: 'beehiiv_missing_post_template',
			},
		];
		await loginAsAdmin( page );
		for ( const c of cases ) {
			seedReadyState( c.seed );
			mockBeehiivPosts();
			await openBeehiivPanel( page, postId );
			const panel = page.locator( '.beehiiv-post-settings-content' );
			await expect( panel, c.name ).toContainText( c.message );
			// The toggle itself shows the same readiness state (disabled) when
			// beehiiv is not ready.
			await expect( previewButton( page ), c.name ).toHaveCount( 0 );

			const r = await restPreview( page, postId );
			expect( r.status, c.name ).toBeGreaterThanOrEqual( 400 );
			expect( r.body.code, c.name ).toBe( c.code );
			expect(
				beehiivPostCalls( readHttpLog() ).filter(
					( e ) => e.mock !== 'get_email' && e.method !== 'GET'
				),
				c.name
			).toEqual( [] );
		}
	} );

	test( 'AC-010: unavailable once the newsletter is scheduled or sent, with a short reason; server refuses without calling beehiiv', async ( {
		page,
	} ) => {
		const scheduled = createPost( {
			title: 'AC-010 scheduled',
			meta: futureLinkedMeta(),
		} );
		const sent = createPost( {
			title: 'AC-010 sent',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_post_id: LINKED_ID,
				_beehiiv_scheduled_at: isoUtc( -2 * 86400 ),
			},
		} );
		await loginAsAdmin( page );
		for ( const id of [ scheduled, sent ] ) {
			await openBeehiivPanel( page, id );
			await expect( previewButton( page ) ).toHaveCount( 0 );
			await expect(
				page.locator( '.beehiiv-email-preview__reason' )
			).toContainText( 'already scheduled or sent' );
		}

		php( 'beehiiv_e2e_clear_http_log();' );
		const before = readNewsletterMeta( scheduled );
		const r = await restPreview( page, scheduled );
		expect( r.status ).toBeGreaterThanOrEqual( 400 );
		expect( r.body.code ).toBe( 'beehiiv_newsletter_confirmed' );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );
		expect( readNewsletterMeta( scheduled ) ).toEqual( before );
	} );

	test( 'AC-010: the linked-status notice explains that edits no longer sync', async ( {
		page,
	} ) => {
		const postId = createPost( {
			title: 'AC-010 notice',
			meta: futureLinkedMeta(),
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		await expect(
			page.locator( '.beehiiv-post-settings-content' )
		).toContainText(
			/no longer (sync|synced|updated)|won.t (sync|update)|edits .* (sync|update)/i
		);
	} );

	test( 'AC-011: only users with publish rights who can edit the post see and use Preview; the server enforces it', async ( {
		page,
		browser,
		request,
	} ) => {
		const authorId = Number(
			php( `echo get_user_by( "login", "${ AUTHOR.login }" )->ID;` )
		);
		const contribId = Number(
			php( `echo get_user_by( "login", "${ CONTRIB.login }" )->ID;` )
		);
		const authorPost = createPost( {
			title: 'AC-011 author post',
			author: authorId,
		} );
		const adminPost = createPost( { title: 'AC-011 admin post' } );
		const contribPost = createPost( {
			title: 'AC-011 contributor post',
			author: contribId,
		} );

		// Author on their own post: sees and can use it.
		await loginAs( page, AUTHOR.login, TEST_USER_PASS );
		await openBeehiivPanel( page, authorPost );
		await expect( previewButton( page ) ).toBeEnabled();
		const ok = await clickPreview( page );
		expect( ok.status() ).toBe( 200 );

		// Author cannot edit someone else's post, even via REST.
		php( 'beehiiv_e2e_clear_http_log();' );
		await page.keyboard.press( 'Escape' );
		const foreign = await restPreview( page, adminPost );
		expect( [ 401, 403 ] ).toContain( foreign.status );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );

		// Contributor (no publish rights): no panel, and REST is refused.
		const ctx = await browser.newContext();
		const cpage = await ctx.newPage();
		await loginAs( cpage, CONTRIB.login, TEST_USER_PASS );
		await openPostEditor( cpage, contribPost );
		await cpage.waitForTimeout( 2000 );
		await expect(
			cpage.getByRole( 'button', { name: 'beehiiv', exact: true } )
		).toHaveCount( 0 );
		await expect( previewButton( cpage ) ).toHaveCount( 0 );
		const denied = await restPreview( cpage, contribPost );
		expect( [ 401, 403 ] ).toContain( denied.status );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );
		await ctx.close();

		// Unauthenticated: refused.
		const anon = await request.post( '/wp-json/beehiiv/v1/email-preview', {
			data: { post_id: authorPost },
		} );
		expect( [ 401, 403 ] ).toContain( anon.status() );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );
	} );

	test( 'AC-012: a post that is not opted in never gets a beehiiv post from Preview', async ( {
		page,
	} ) => {
		const postId = createPost( {
			title: 'AC-012 post',
			meta: { _beehiiv_send_to_newsletter: '' },
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, postId );
		php( 'beehiiv_e2e_clear_http_log();' );
		const before = readNewsletterMeta( postId );

		const r = await restPreview( page, postId );
		expect( r.status ).toBeGreaterThanOrEqual( 400 );
		expect( r.body.code ).toBe( 'beehiiv_preview_not_opted_in' );
		expect( beehiivPostCalls( readHttpLog() ) ).toEqual( [] );
		expect( readNewsletterMeta( postId ) ).toEqual( before );
		expect( readNewsletterMeta( postId )._beehiiv_post_id ).toBe( '' );
	} );

	// ----- US-003 -----------------------------------------------------------

	test( 'AC-013: failures show distinct, classified messages in the modal', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-013 post' } );
		const emptyPost = createPost( {
			title: 'AC-013 empty',
			content: '',
		} );
		await loginAsAdmin( page );

		const expectMessage = async ( id, mocks, text, label ) => {
			seedReadyState();
			mockBeehiivPosts( mocks );
			await openBeehiivPanel( page, id );
			await clickPreview( page );
			await expect( modal( page ), label ).toContainText( text, {
				timeout: 30000,
			} );
			await expect( emailFrame( page ), label ).toHaveCount( 0 );
			await expect(
				modal( page ).getByRole( 'button', { name: 'Try again' } ),
				label
			).toBeVisible();
			await page.keyboard.press( 'Escape' );
		};

		// Connection or permission problem.
		await expectMessage(
			postId,
			{
				email: {
					status: 403,
					body: { message: 'Forbidden' },
				},
			},
			'Reconnect your account',
			'connection/permission (fetch 403)'
		);
		await expectMessage(
			postId,
			{
				create: { status: 401, body: { message: 'Unauthorized' } },
				update: { status: 401, body: { message: 'Unauthorized' } },
			},
			'Reconnect your account',
			'connection/permission (create 401)'
		);
		// Plan problem.
		await expectMessage(
			postId,
			{
				update: { status: 402, body: { message: 'Upgrade' } },
				create: { status: 402, body: { message: 'Upgrade' } },
			},
			'Max and Enterprise',
			'plan (402)'
		);
		// Content problem: the same message a real send shows.
		await expectMessage(
			emptyPost,
			{},
			/Add a title and body content|doesn't include any blocks/,
			'content'
		);
		// Still being prepared.
		await expectMessage(
			postId,
			{ email: emailBody( '' ) },
			'still preparing',
			'processing'
		);
		// Any other failure includes beehiiv's own message.
		await expectMessage(
			postId,
			{
				email: {
					status: 500,
					body: { message: 'beehiiv exploded e2e' },
				},
			},
			'beehiiv exploded e2e',
			'other failure'
		);
	} );

	test( 'AC-014: a failed preview never changes the newsletter error state, link, send toggle, or send date', async ( {
		page,
	} ) => {
		const sendDate = php(
			'echo wp_date( "Y-m-d\\\\TH:i:s", time() + 5 * DAY_IN_SECONDS );'
		);
		const fresh = createPost( {
			title: 'AC-014 fresh',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_send_to_newsletter_date: sendDate,
			},
		} );
		const draftLinked = createPost( {
			title: 'AC-014 draft linked',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_send_to_newsletter_date: sendDate,
				_beehiiv_post_id: DRAFT_ID,
				_beehiiv_post_state: 'draft',
			},
		} );
		const beforeFresh = readNewsletterMeta( fresh );
		const beforeLinked = readNewsletterMeta( draftLinked );

		await loginAsAdmin( page );
		const failing = [
			[ fresh, { create: { status: 500, body: { message: 'boom' } } } ],
			[ fresh, { email: { status: 500, body: { message: 'boom' } } } ],
			[
				draftLinked,
				{ update: { status: 500, body: { message: 'boom' } } },
			],
			[
				draftLinked,
				{ email: { status: 403, body: { message: 'no' } } },
			],
			[ draftLinked, { email: emailBody( '' ) } ],
		];
		for ( const [ id, mocks ] of failing ) {
			seedReadyState();
			mockBeehiivPosts( mocks );
			await openBeehiivPanel( page, id );
			await clickPreview( page );
			await expect(
				modal( page ).getByRole( 'button', { name: 'Try again' } )
			).toBeVisible( { timeout: 30000 } );
			await page.keyboard.press( 'Escape' );
		}

		expect( readNewsletterMeta( draftLinked ) ).toEqual( beforeLinked );
		// A fresh post whose create failed gets no link; the fetch-failure case
		// above ran after a successful create, so only the draft link differs.
		const afterFresh = readNewsletterMeta( fresh );
		expect( afterFresh._beehiiv_newsletter_error ).toBe(
			beforeFresh._beehiiv_newsletter_error
		);
		expect( afterFresh._beehiiv_newsletter_error_type ).toBe(
			beforeFresh._beehiiv_newsletter_error_type
		);
		expect( afterFresh._beehiiv_send_to_newsletter ).toBe(
			beforeFresh._beehiiv_send_to_newsletter
		);
		expect( afterFresh._beehiiv_send_to_newsletter_date ).toBe(
			beforeFresh._beehiiv_send_to_newsletter_date
		);
		expect( afterFresh._beehiiv_scheduled_at ).toBe(
			beforeFresh._beehiiv_scheduled_at
		);
	} );

	test( 'AC-015: the publisher can retry from the modal without closing it', async ( {
		page,
	} ) => {
		const postId = createPost( { title: 'AC-015 post' } );
		mockBeehiivPosts( {
			email: { status: 500, body: { message: 'temporary e2e failure' } },
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await clickPreview( page );
		await expect( modal( page ) ).toContainText( 'temporary e2e failure', {
			timeout: 30000,
		} );
		await expect( emailFrame( page ) ).toHaveCount( 0 );

		// beehiiv recovers; retry inside the same modal instance.
		mockBeehiivPosts();
		const retried = page.waitForResponse(
			( res ) =>
				res.url().includes( 'beehiiv/v1/email-preview' ) &&
				res.request().method() === 'POST'
		);
		await modal( page )
			.getByRole( 'button', { name: 'Try again' } )
			.click();
		expect( ( await retried ).status() ).toBe( 200 );

		await expect( modal( page ) ).toBeVisible();
		await expect( emailFrame( page ) ).toBeVisible();
		await expect( modal( page ) ).not.toContainText(
			'temporary e2e failure'
		);
	} );
} );
