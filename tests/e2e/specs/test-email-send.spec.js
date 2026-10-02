const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { openPostEditor } = require( '../utils/editor' );
const {
	wpCli,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/06-editor-integration/5-newsletter-preview/test-email-send.prd.md
 *
 * Behavioral coverage, authored independently of the build session from the
 * PRD's Acceptance Criteria + Technical Approach and the current code at the
 * PLAN/EXECUTION file lists:
 * - includes/REST/TestSendController.php  (POST /beehiiv/v1/test-send)
 * - includes/Newsletter/TestSender.php    (eligibility, temp draft, errors)
 * - includes/API/Resources/Posts.php      (create / test_send / delete)
 * - src/js/editor/post-settings/components/test-email-send.js
 * - src/js/editor/post-settings/index.js  ("Test email" PanelBody)
 *
 * beehiiv is never contacted: every outbound call is answered by the
 * test-only mu-plugin (tests/e2e/plugins/beehiiv-options.php, tests env
 * only), which also logs each mocked request so specs can assert exactly
 * what the plugin sent to beehiiv (create body, test_sends recipients,
 * delete). The connection is seeded through the real TokenStore and the
 * Send API check through a mocked /workspaces/permissions response.
 *
 * Assumption carried from the implementation (not stated by beehiiv's docs
 * or the PRD): beehiiv signals "daily limit reached" with HTTP 422 and rate
 * limiting with HTTP 429 on /test_sends; the mocks follow that.
 */

const PUB = 'pub_e2e';
const PUB_TWO = 'pub_e2e_two';
const TPL = 'tpl_e2e';
const TMP_ID = 'post_tmp_e2e';
const LINKED_ID = 'post_linked_e2e';
const SITE_TZ = 'America/New_York';

// Test-only users created in this spec's own tests environment.
const AUTHOR = { login: 'qa_e2e_author', role: 'author' };
const CONTRIB = { login: 'qa_e2e_contrib', role: 'contributor' };
const TEST_USER_PASS = 'qa-e2e-test-send-pass';

const CONTENT =
	'<!-- wp:paragraph --><p>Hello from the beehiiv test send spec.</p><!-- /wp:paragraph -->';

const NEWSLETTER_META_KEYS = [
	'_beehiiv_post_id',
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

/** Runs arbitrary PHP inside the tests environment and returns its output. */
function php( code ) {
	return wpCli( `eval 'eval( base64_decode( "${ b64( code ) }" ) );'` );
}

/** Runs PHP that echoes JSON and returns it parsed. */
function phpJson( code ) {
	const out = php( code );
	const start = out.search( /[\[{"]|null|true|false|\d/ );
	return JSON.parse( out.slice( start ) );
}

/** Passes a JS value into PHP as a decoded array expression. */
const phpArg = ( value ) =>
	`json_decode( base64_decode( "${ b64( JSON.stringify( value ) ) }" ), true )`;

/**
 * Connected, Send-API-enabled, publication + template configured, no mocks
 * beyond permissions, empty request log, no remembered reset time.
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
		delete_option( "beehiiv_test_send_reset_at" );
		update_option( "timezone_string", "${ SITE_TZ }" );
	` );
}

/**
 * Registers beehiiv post endpoint mocks. Patterns are anchored so create,
 * test_sends, and delete (which share a URL prefix) never cross-match.
 */
function mockBeehiivPosts( {
	testSend = {
		status: 200,
		body: { data: { remaining_test_sends: 4, reset_at: null } },
	},
	create = { status: 201, body: { data: { id: TMP_ID } } },
	del = { status: 204, body: '' },
} = {} ) {
	const mocks = {
		test_sends: {
			pattern: '#/publications/[^/]+/posts/[^/?]+/test_sends(\\?|$)#',
			method: 'POST',
			...testSend,
		},
		create_post: {
			pattern: '#/publications/[^/]+/posts(\\?|$)#',
			method: 'POST',
			...create,
		},
		delete_post: {
			pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
			method: 'DELETE',
			...del,
		},
	};
	php( `
		foreach ( ${ phpArg( mocks ) } as $key => $mock ) {
			beehiiv_e2e_mock_http( $key, $mock );
		}
	` );
}

/** Mocked outbound requests the plugin made since the last reset. */
function readHttpLog() {
	return phpJson(
		'echo wp_json_encode( array_values( (array) get_option( "beehiiv_e2e_http_log", [] ) ) );'
	);
}

const beehiivPostCalls = ( log ) =>
	log.filter( ( entry ) => entry.mock !== '/workspaces/permissions' );

/** Creates a post directly in the DB (no REST, so no newsletter sync runs). */
function createPost( {
	title = 'Test send post',
	content = CONTENT,
	status = 'draft',
	author = 1,
	meta = {},
} = {} ) {
	const id = Number(
		php( `
			$args = [
				"post_title"   => ${ phpArg( title ) },
				"post_content" => ${ phpArg( content ) },
				"post_status"  => "${ status }",
				"post_author"  => ${ Number( author ) },
				"post_type"    => "post",
			];
			if ( "future" === $args["post_status"] ) {
				$args["post_date"] = wp_date( "Y-m-d H:i:s", time() + 3 * DAY_IN_SECONDS );
			}
			$id = wp_insert_post( $args, true );
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

function readNewsletterMeta( postId ) {
	return phpJson( `
		$out = [];
		foreach ( ${ phpArg( NEWSLETTER_META_KEYS ) } as $key ) {
			$out[ $key ] = get_post_meta( ${ postId }, $key, true );
		}
		echo wp_json_encode( $out );
	` );
}

function readRememberedResetAt() {
	return phpJson(
		'echo wp_json_encode( get_option( "beehiiv_test_send_reset_at", null ) );'
	);
}

/** wp_date() of a timestamp in the site timezone, without the zone abbreviation. */
function siteDate( timestamp ) {
	return php( `echo wp_date( "F j, g:i a", ${ timestamp } );` );
}

const isoUtc = ( offsetSeconds ) =>
	new Date( Date.now() + offsetSeconds * 1000 )
		.toISOString()
		.replace( /\.\d{3}Z$/, 'Z' );

const futureLinkedMeta = () => ( {
	_beehiiv_post_id: LINKED_ID,
	_beehiiv_scheduled_at: isoUtc( 2 * 86400 ),
} );

const sentLinkedMeta = () => ( {
	_beehiiv_post_id: LINKED_ID,
	_beehiiv_scheduled_at: isoUtc( -2 * 86400 ),
} );

// ---------------------------------------------------------------------------
// Editor helpers
// ---------------------------------------------------------------------------

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
	await expect( page.locator( '.beehiiv-post-settings-content' ) ).toBeVisible();
}

const testEmailSection = ( page ) => page.locator( '.beehiiv-test-email' );
const recipientsField = ( page ) => page.getByLabel( 'Send test email to' );
const sendButton = ( page ) =>
	page.getByRole( 'button', { name: 'Send test email', exact: true } );

async function expectSendEnabled( page ) {
	await expect( sendButton( page ) ).toBeVisible();
	await expect( sendButton( page ) ).not.toHaveAttribute( 'aria-disabled', 'true' );
	await expect( sendButton( page ) ).toBeEnabled();
}

async function expectSendDisabled( page ) {
	await expect( sendButton( page ) ).toBeVisible();
	const ariaDisabled = await sendButton( page ).getAttribute( 'aria-disabled' );
	const disabled = await sendButton( page ).isDisabled();
	expect( ariaDisabled === 'true' || disabled ).toBe( true );
}

async function sendFromUi( page, recipients ) {
	await recipientsField( page ).fill( recipients );
	const response = page.waitForResponse(
		( res ) =>
			res.url().includes( 'beehiiv/v1/test-send' ) &&
			res.request().method() === 'POST',
		{ timeout: 20000 }
	);
	await sendButton( page ).click();
	return response;
}

/**
 * POSTs straight to the REST route with the logged-in user's REST nonce,
 * bypassing the editor UI entirely (AC-017). Call on any block editor page.
 */
async function restTestSend( page, postId, recipients = 'qa@example.com' ) {
	return page.evaluate(
		async ( { id, to } ) => {
			const res = await window.fetch(
				window.wpApiSettings.root + 'beehiiv/v1/test-send',
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': window.wpApiSettings.nonce,
					},
					body: JSON.stringify( { post_id: id, recipients: to } ),
				}
			);
			let body = null;
			try {
				body = await res.json();
			} catch ( e ) {}
			return { status: res.status, body };
		},
		{ id: postId, to: recipients }
	);
}

// ---------------------------------------------------------------------------

test.describe( 'Test Email Send (PRD-06.5)', () => {
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
			delete_option( "beehiiv_test_send_reset_at" );
			update_option( "timezone_string", "" );
		` );
	} );

	// ----- US-001 -----------------------------------------------------------

	test( 'AC-001: "Send test email" control is in the beehiiv editor panel and not on the posts list', async ( { page } ) => {
		const postId = createPost( { title: 'AC-001 post' } );
		await loginAsAdmin( page );

		await openBeehiivPanel( page, postId );
		await expect(
			page.locator( '.beehiiv-post-settings-content' ).getByRole( 'button', { name: 'Test email', exact: true } )
		).toBeVisible();
		await expect( recipientsField( page ) ).toBeVisible();
		await expectSendEnabled( page );

		await page.goto( '/wp-admin/edit.php' );
		await expect( page.locator( `#post-${ postId }` ) ).toBeVisible();
		await page.locator( `#post-${ postId }` ).hover();
		await expect( page.locator( '#wpbody' ) ).not.toContainText( /test email/i );
		await expect( page.locator( '#wpbody' ) ).not.toContainText( /test send/i );
	} );

	test( 'AC-002: recipients field is empty on every open and never prefilled', async ( { page } ) => {
		const postId = createPost( { title: 'AC-002 post' } );
		await loginAsAdmin( page );

		await openBeehiivPanel( page, postId );
		await expect( recipientsField( page ) ).toHaveValue( '' );

		// A successful send, then reopening the editor: still empty.
		await sendFromUi( page, 'first@example.com' );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );

		await openBeehiivPanel( page, postId );
		await expect( recipientsField( page ) ).toHaveValue( '' );

		// Admin's own email is never used as a default either.
		const adminEmail = php( 'echo get_option( "admin_email" );' );
		await expect( recipientsField( page ) ).not.toHaveValue( adminEmail );
	} );

	test( 'AC-003: commas/new lines split, whitespace trimmed, duplicates removed before sending', async ( { page } ) => {
		const postId = createPost( { title: 'AC-003 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		const res = await sendFromUi(
			page,
			'  one@example.com , two@example.com\n\nthree@example.com,one@example.com\n  TWO@example.com  '
		);
		expect( res.status() ).toBe( 200 );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );

		const sends = readHttpLog().filter( ( e ) => e.mock === 'test_sends' );
		expect( sends ).toHaveLength( 1 );
		expect( sends[ 0 ].body.recipient_emails ).toEqual( [
			'one@example.com',
			'two@example.com',
			'three@example.com',
		] );
	} );

	test( 'AC-004: invalid addresses block the send and are named; no recipient cap', async ( { page } ) => {
		const postId = createPost( { title: 'AC-004 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await recipientsField( page ).fill( 'good@example.com, not-an-email\nalso bad@x' );
		await sendButton( page ).click();
		await expect( testEmailSection( page ) ).toContainText( "These email addresses aren't valid" );
		await expect( testEmailSection( page ) ).toContainText( 'not-an-email' );
		await expect( testEmailSection( page ) ).toContainText( 'also bad@x' );
		await expect( testEmailSection( page ) ).not.toContainText( 'Test email sent.' );
		expect( readHttpLog().filter( ( e ) => e.mock === 'test_sends' ) ).toHaveLength( 0 );

		// 75 distinct addresses all go through in one send.
		const many = Array.from( { length: 75 }, ( _, i ) => `bulk${ i }@example.com` );
		const res = await sendFromUi( page, many.join( ', ' ) );
		expect( res.status() ).toBe( 200 );
		const sends = readHttpLog().filter( ( e ) => e.mock === 'test_sends' );
		expect( sends ).toHaveLength( 1 );
		expect( sends[ 0 ].body.recipient_emails ).toEqual( many );
	} );

	test( 'AC-005: send is disabled with a save note while the post has unsaved changes; never auto-saves', async ( { page } ) => {
		const postId = createPost( { title: 'AC-005 original title' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		await expectSendEnabled( page );

		const postWrites = [];
		page.on( 'request', ( req ) => {
			if (
				new RegExp( `/wp/v2/posts/${ postId }(\\?|$|/)` ).test( req.url() ) &&
				req.method() !== 'GET'
			) {
				postWrites.push( req.url() );
			}
		} );

		const title = page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.locator( '.editor-post-title__input, [aria-label="Add title"]' )
			.first();
		await title.click();
		await page.keyboard.press( 'End' );
		await page.keyboard.type( ' EDITED' );

		await expect( testEmailSection( page ) ).toContainText(
			'Save the post to include your latest edits.'
		);
		await expectSendDisabled( page );

		await recipientsField( page ).fill( 'dirty@example.com' );
		await sendButton( page ).click( { force: true } );
		await page.waitForTimeout( 1500 );

		expect( readHttpLog().filter( ( e ) => e.mock === 'test_sends' ) ).toHaveLength( 0 );
		expect( postWrites ).toHaveLength( 0 );
		expect( php( `echo get_post_field( "post_title", ${ postId } );` ) ).toBe(
			'AC-005 original title'
		);
	} );

	test( 'AC-006: send is disabled while the post is saving and while a test send is in progress', async ( { page } ) => {
		const postId = createPost( { title: 'AC-006 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		await expectSendEnabled( page );

		// In progress: beehiiv answers after 4s.
		mockBeehiivPosts( {
			testSend: {
				status: 200,
				delay_ms: 4000,
				body: { data: { remaining_test_sends: 3, reset_at: null } },
			},
		} );
		await recipientsField( page ).fill( 'progress@example.com' );
		const done = page.waitForResponse( ( r ) => r.url().includes( 'beehiiv/v1/test-send' ), {
			timeout: 20000,
		} );
		await sendButton( page ).click();
		await expectSendDisabled( page );
		await done;
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		await expectSendEnabled( page );

		// Saving: hold the post save request for 4s and sample the editor's
		// saving flag and the button state together, in the same tick.
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
			.poll( () => page.evaluate( () => window.wp.data.select( 'core/editor' ).isSavingPost() ), {
				timeout: 5000,
			} )
			.toBe( true );
		const sample = await page.evaluate( () => {
			const btn = [ ...document.querySelectorAll( '.beehiiv-test-email button' ) ].find(
				( b ) => b.textContent.trim() === 'Send test email'
			);
			return {
				saving: window.wp.data.select( 'core/editor' ).isSavingPost(),
				dirty: window.wp.data.select( 'core/editor' ).isEditedPostDirty(),
				disabled: !! btn && ( btn.disabled || btn.getAttribute( 'aria-disabled' ) === 'true' ),
			};
		} );
		expect( sample.saving ).toBe( true );
		expect( sample.disabled ).toBe( true );
		await expect
			.poll(
				() => page.evaluate( () => window.wp.data.select( 'core/editor' ).isSavingPost() ),
				{ timeout: 15000 }
			)
			.toBe( false );
		await expectSendEnabled( page );
	} );

	test( 'AC-007: a linked, not-yet-sent newsletter is tested directly (no temporary draft)', async ( { page } ) => {
		const postId = createPost( { title: 'AC-007 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		const res = await sendFromUi( page, 'linked@example.com' );
		expect( res.status() ).toBe( 200 );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );

		const calls = beehiivPostCalls( readHttpLog() );
		expect( calls.map( ( c ) => c.mock ) ).toEqual( [ 'test_sends' ] );
		expect( calls[ 0 ].url ).toContain( `/publications/${ PUB }/posts/${ LINKED_ID }/test_sends` );
	} );

	test( 'AC-008: no linked newsletter -> temporary draft from saved content, tested, then deleted', async ( { page } ) => {
		const postId = createPost( { title: 'AC-008 saved title' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		const res = await sendFromUi( page, 'temp@example.com' );
		expect( res.status() ).toBe( 200 );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );

		const calls = beehiivPostCalls( readHttpLog() );
		expect( calls.map( ( c ) => `${ c.method } ${ c.mock }` ) ).toEqual( [
			'POST create_post',
			'POST test_sends',
			'DELETE delete_post',
		] );
		expect( calls[ 1 ].url ).toContain( `/posts/${ TMP_ID }/test_sends` );
		expect( calls[ 2 ].url ).toMatch( new RegExp( `/posts/${ TMP_ID }(\\?|$)` ) );

		// Same conversion/settings as a real send: compare to the real-send builder output.
		const created = calls[ 0 ].body;
		const realSend = phpJson(
			`echo wp_json_encode( \\Beehiiv\\Newsletter\\PostSettingsBuilder::get_post_settings( ${ postId }, true ) );`
		);
		expect( created.title ).toBe( 'AC-008 saved title' );
		expect( created.post_template_id ).toBe( TPL );
		expect( created.blocks ).toEqual( realSend.blocks );
		expect( created.blocks.length ).toBeGreaterThan( 0 );
		expect( created.email_settings ).toEqual( realSend.email_settings );
		expect( created.web_settings ).toEqual( realSend.web_settings );
	} );

	test( 'AC-009: the temporary beehiiv post is always a draft with no send time, even if a filter says otherwise', async ( { page } ) => {
		const postId = createPost( {
			title: 'AC-009 post',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_send_to_newsletter_date: php(
					'echo wp_date( "Y-m-d\\\\TH:i:s", time() + 5 * DAY_IN_SECONDS );'
				),
			},
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		// Plain run.
		await sendFromUi( page, 'draft@example.com' );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		let create = readHttpLog().find( ( e ) => e.mock === 'create_post' );
		expect( create.body.status ).toBe( 'draft' );
		expect( create.body ).not.toHaveProperty( 'scheduled_at' );

		// Third-party filter forces confirmed + scheduled_at (BR-005).
		php( 'beehiiv_e2e_clear_http_log(); update_option( "beehiiv_e2e_force_settings_status", "confirmed" );' );
		await sendFromUi( page, 'draft@example.com' );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		create = readHttpLog().find( ( e ) => e.mock === 'create_post' );
		expect( create.body.status ).toBe( 'draft' );
		expect( create.body ).not.toHaveProperty( 'scheduled_at' );
		php( 'delete_option( "beehiiv_e2e_force_settings_status" );' );
	} );

	test( 'AC-010: a test send never changes newsletter link, send toggle, send date, or error state', async ( { page } ) => {
		const sendDate = php( 'echo wp_date( "Y-m-d\\\\TH:i:s", time() + 5 * DAY_IN_SECONDS );' );
		const linkedId = createPost( {
			title: 'AC-010 linked',
			meta: { ...futureLinkedMeta(), _beehiiv_send_to_newsletter: '1' },
		} );
		const tempId = createPost( {
			title: 'AC-010 temp',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_send_to_newsletter_date: sendDate,
			},
		} );
		const beforeLinked = readNewsletterMeta( linkedId );
		const beforeTemp = readNewsletterMeta( tempId );

		await loginAsAdmin( page );
		for ( const id of [ linkedId, tempId ] ) {
			await openBeehiivPanel( page, id );
			await sendFromUi( page, 'meta@example.com' );
			await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		}
		// A failed send must not leave an error state either.
		mockBeehiivPosts( { testSend: { status: 500, body: { message: 'boom' } } } );
		await sendFromUi( page, 'meta@example.com' );
		await expect( testEmailSection( page ) ).toContainText( "wasn't sent" );

		expect( readNewsletterMeta( linkedId ) ).toEqual( beforeLinked );
		expect( readNewsletterMeta( tempId ) ).toEqual( beforeTemp );
		// No PATCH/update of the real newsletter was attempted.
		expect( readHttpLog().filter( ( e ) => e.method === 'PATCH' ) ).toHaveLength( 0 );
	} );

	test( 'AC-011: the temporary draft is still deleted when the test send fails', async ( { page } ) => {
		const postId = createPost( { title: 'AC-011 post' } );
		mockBeehiivPosts( {
			testSend: { status: 500, body: { message: 'Internal error' } },
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await sendFromUi( page, 'fail@example.com' );
		await expect( testEmailSection( page ) ).toContainText( "wasn't sent" );

		const calls = beehiivPostCalls( readHttpLog() );
		expect( calls.map( ( c ) => `${ c.method } ${ c.mock }` ) ).toEqual( [
			'POST create_post',
			'POST test_sends',
			'DELETE delete_post',
		] );
		expect( calls[ 2 ].url ).toMatch( new RegExp( `/posts/${ TMP_ID }(\\?|$)` ) );
	} );

	// ----- US-002 -----------------------------------------------------------

	test( 'AC-012: available for saved draft, pending, and scheduled posts, with or without "Send to newsletter"', async ( { page } ) => {
		await loginAsAdmin( page );
		for ( const status of [ 'draft', 'pending', 'future' ] ) {
			for ( const toggle of [ '', '1' ] ) {
				const postId = createPost( {
					title: `AC-012 ${ status } toggle=${ toggle || 'off' }`,
					status,
					meta: { _beehiiv_send_to_newsletter: toggle },
				} );
				await openBeehiivPanel( page, postId );
				await expect( testEmailSection( page ) ).not.toContainText( 'Test emails are available for' );
				await expectSendEnabled( page );
				const res = await sendFromUi( page, 'avail@example.com' );
				expect( res.status(), `${ status } toggle=${ toggle }` ).toBe( 200 );
				await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
			}
		}
	} );

	test( 'AC-013: not available on published, private, or already-sent posts, with a short reason', async ( { page } ) => {
		const cases = [
			{ status: 'publish', meta: {}, reason: 'Test emails are available for drafts, pending posts, and scheduled posts.' },
			{ status: 'private', meta: {}, reason: 'Test emails are available for drafts, pending posts, and scheduled posts.' },
			{ status: 'draft', meta: sentLinkedMeta(), reason: "This post's newsletter was already sent, so it can't send a test email." },
		];
		await loginAsAdmin( page );
		for ( const c of cases ) {
			const postId = createPost( { title: `AC-013 ${ c.status }`, status: c.status, meta: c.meta } );
			await openBeehiivPanel( page, postId );
			await expect( testEmailSection( page ) ).toContainText( c.reason );
			await expect( sendButton( page ) ).toHaveCount( 0 );
			await expect( recipientsField( page ) ).toHaveCount( 0 );
		}
	} );

	test( 'AC-014: only users with publish rights who can edit the post see the control', async ( { page, browser } ) => {
		// Author (publish_posts) on their own draft: sees and can use it.
		const authorId = Number( php( `echo get_user_by( "login", "${ AUTHOR.login }" )->ID;` ) );
		const contribId = Number( php( `echo get_user_by( "login", "${ CONTRIB.login }" )->ID;` ) );
		const authorPost = createPost( { title: 'AC-014 author post', author: authorId } );
		const contribPost = createPost( { title: 'AC-014 contributor post', author: contribId } );

		await loginAs( page, AUTHOR.login, TEST_USER_PASS );
		await openBeehiivPanel( page, authorPost );
		await expectSendEnabled( page );

		// Contributor (no publish_posts) on their own draft: no beehiiv panel at all.
		const ctx = await browser.newContext();
		const cpage = await ctx.newPage();
		await loginAs( cpage, CONTRIB.login, TEST_USER_PASS );
		await openPostEditor( cpage, contribPost );
		await cpage.waitForTimeout( 2000 );
		await expect( cpage.getByRole( 'button', { name: 'beehiiv', exact: true } ) ).toHaveCount( 0 );
		await expect( cpage.getByRole( 'button', { name: 'Send test email' } ) ).toHaveCount( 0 );
		await ctx.close();
	} );

	test( 'AC-015: unavailable when beehiiv is not ready, showing the same readiness message as the toggle', async ( { page } ) => {
		const postId = createPost( { title: 'AC-015 post' } );
		const cases = [
			{ name: 'not connected', seed: { connected: false }, message: 'Connect your beehiiv account' },
			{ name: 'no Send API', seed: { permissions: { posts: [ 'read' ] } }, message: "doesn't have access to send newsletters" },
			{ name: 'no publication', seed: { settings: { publication_id: '' } }, message: 'Choose a publication in' },
			{ name: 'no template', seed: { settings: { post_template_id: '' } }, message: 'Choose a default post template in' },
		];
		await loginAsAdmin( page );
		for ( const c of cases ) {
			seedReadyState( c.seed );
			mockBeehiivPosts();
			await openBeehiivPanel( page, postId );
			const panel = page.locator( '.beehiiv-post-settings-content' );
			await expect( panel, c.name ).toContainText( c.message );
			await expect( panel.getByRole( 'button', { name: 'Test email', exact: true } ), c.name ).toHaveCount( 0 );
			await expect( sendButton( page ), c.name ).toHaveCount( 0 );
		}
	} );

	test( 'AC-016: scheduled post whose last beehiiv sync failed shows the out-of-sync note', async ( { page } ) => {
		const postId = createPost( {
			title: 'AC-016 post',
			status: 'future',
			meta: {
				...futureLinkedMeta(),
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_newsletter_error: 'beehiiv is temporarily unavailable. Try again later.',
				_beehiiv_newsletter_error_type: 'save',
			},
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		await expect( testEmailSection( page ) ).toContainText( "isn't in sync with beehiiv" );
		await expect( testEmailSection( page ) ).toContainText( 'Save the post again' );
		await expect( sendButton( page ) ).toHaveCount( 0 );
	} );

	test( 'AC-017: server refuses ineligible posts and invalid input when the UI is bypassed', async ( { page } ) => {
		const editable = createPost( { title: 'AC-017 host' } );
		const published = createPost( { title: 'AC-017 published', status: 'publish' } );
		const privatePost = createPost( { title: 'AC-017 private', status: 'private' } );
		const sent = createPost( { title: 'AC-017 sent', meta: sentLinkedMeta() } );
		const outOfSync = createPost( {
			title: 'AC-017 out of sync',
			status: 'future',
			meta: { ...futureLinkedMeta(), _beehiiv_newsletter_error: 'sync failed', _beehiiv_newsletter_error_type: 'save' },
		} );

		await loginAsAdmin( page );
		await openPostEditor( page, editable );

		for ( const [ id, code ] of [
			[ published, 'beehiiv_test_send_ineligible_status' ],
			[ privatePost, 'beehiiv_test_send_ineligible_status' ],
			[ sent, 'beehiiv_test_send_already_sent' ],
			[ outOfSync, 'beehiiv_test_send_out_of_sync' ],
		] ) {
			const r = await restTestSend( page, id );
			expect( r.status, code ).toBeGreaterThanOrEqual( 400 );
			expect( r.body.code ).toBe( code );
		}

		const invalid = await restTestSend( page, editable, 'ok@example.com, nope' );
		expect( invalid.status ).toBe( 400 );
		expect( invalid.body.message ).toContain( 'nope' );

		const empty = await restTestSend( page, editable, ' , \n ' );
		expect( empty.status ).toBe( 400 );

		for ( const [ seed, code ] of [
			[ { connected: false }, 'beehiiv_not_connected' ],
			[ { permissions: { posts: [ 'read' ] } }, 'beehiiv_send_api_unavailable' ],
			[ { settings: { publication_id: '' } }, 'beehiiv_missing_publication' ],
		] ) {
			seedReadyState( seed );
			mockBeehiivPosts();
			const r = await restTestSend( page, editable );
			expect( r.status, code ).toBeGreaterThanOrEqual( 400 );
			expect( r.body.code ).toBe( code );
		}

		expect( readHttpLog().filter( ( e ) => e.mock === 'test_sends' ) ).toHaveLength( 0 );
	} );

	test( 'AC-017: server refuses users without publish or edit rights when the UI is bypassed', async ( { browser } ) => {
		const authorId = Number( php( `echo get_user_by( "login", "${ AUTHOR.login }" )->ID;` ) );
		const contribId = Number( php( `echo get_user_by( "login", "${ CONTRIB.login }" )->ID;` ) );
		const adminPost = createPost( { title: 'AC-017 admin post', author: 1 } );
		const authorPost = createPost( { title: 'AC-017 author own', author: authorId } );
		const contribPost = createPost( { title: 'AC-017 contrib own', author: contribId } );

		// Contributor: can edit own draft but lacks publish_posts.
		let ctx = await browser.newContext();
		let p = await ctx.newPage();
		await loginAs( p, CONTRIB.login, TEST_USER_PASS );
		await openPostEditor( p, contribPost );
		let r = await restTestSend( p, contribPost );
		expect( r.status ).toBe( 403 );
		await ctx.close();

		// Author: has publish_posts but cannot edit the admin's post.
		ctx = await browser.newContext();
		p = await ctx.newPage();
		await loginAs( p, AUTHOR.login, TEST_USER_PASS );
		await openPostEditor( p, authorPost );
		r = await restTestSend( p, adminPost );
		expect( r.status ).toBe( 403 );
		await ctx.close();

		expect( readHttpLog().filter( ( e ) => e.mock === 'test_sends' ) ).toHaveLength( 0 );
	} );

	test( 'AC-017: server refuses when no post template is configured (same readiness rule as the toggle)', async ( { page } ) => {
		const unlinked = createPost( { title: 'AC-017 no template unlinked' } );
		const linked = createPost( { title: 'AC-017 no template linked', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openPostEditor( page, unlinked );

		seedReadyState( { settings: { post_template_id: '' } } );
		mockBeehiivPosts();

		const r1 = await restTestSend( page, unlinked );
		expect( r1.status, 'unlinked post, no template' ).toBeGreaterThanOrEqual( 400 );

		const r2 = await restTestSend( page, linked );
		expect( r2.status, 'linked unsent post, no template' ).toBeGreaterThanOrEqual( 400 );

		expect( readHttpLog().filter( ( e ) => e.mock === 'test_sends' ) ).toHaveLength( 0 );
	} );

	// ----- US-003 -----------------------------------------------------------

	test( 'AC-018: success shows confirmation, sends left today, and reset time in the site timezone', async ( { page } ) => {
		const resetAt = Math.floor( Date.now() / 1000 ) + 6 * 3600 + 17 * 60;
		mockBeehiivPosts( {
			testSend: { status: 200, body: { data: { remaining_test_sends: 7, reset_at: resetAt } } },
		} );
		const postId = createPost( { title: 'AC-018 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await sendFromUi( page, 'success@example.com' );
		const section = testEmailSection( page );
		await expect( section ).toContainText( 'Test email sent.' );
		await expect( section ).toContainText( '7 test sends left today.' );
		const expectedLocal = siteDate( resetAt );
		await expect( section ).toContainText( `Test sends reset on ${ expectedLocal }` );

		// Sanity: the site timezone rendering differs from a UTC rendering.
		const utc = php( `echo gmdate( "F j, g:i a", ${ resetAt } );` );
		expect( utc ).not.toBe( expectedLocal );
	} );

	test( 'AC-019: last reset time is remembered per publication from successful sends', async ( { page } ) => {
		const resetOne = Math.floor( Date.now() / 1000 ) + 5 * 3600;
		const resetTwo = resetOne + 3600;
		const postId = createPost( { title: 'AC-019 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );

		mockBeehiivPosts( { testSend: { status: 200, body: { data: { remaining_test_sends: 2, reset_at: resetOne } } } } );
		await openBeehiivPanel( page, postId );
		await sendFromUi( page, 'r1@example.com' );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		expect( readRememberedResetAt() ).toEqual( { [ PUB ]: resetOne } );

		// Failed send must not overwrite it.
		mockBeehiivPosts( { testSend: { status: 500, body: { message: 'x' } } } );
		await sendFromUi( page, 'r1@example.com' );
		await expect( testEmailSection( page ) ).toContainText( "wasn't sent" );
		expect( readRememberedResetAt() ).toEqual( { [ PUB ]: resetOne } );

		// Second publication keeps its own value alongside the first.
		php( `
			remove_all_filters( "sanitize_option_beehiiv_settings" );
			update_option( "beehiiv_settings", [ "publication_id" => "${ PUB_TWO }", "post_template_id" => "${ TPL }" ] );
		` );
		mockBeehiivPosts( { testSend: { status: 200, body: { data: { remaining_test_sends: 1, reset_at: resetTwo } } } } );
		await openBeehiivPanel( page, postId );
		await sendFromUi( page, 'r2@example.com' );
		await expect( testEmailSection( page ) ).toContainText( 'Test email sent.' );
		expect( readRememberedResetAt() ).toEqual( { [ PUB ]: resetOne, [ PUB_TWO ]: resetTwo } );
	} );

	test( 'AC-020: daily limit shows all sends used, with the remembered reset time only when still in the future', async ( { page } ) => {
		const postId = createPost( { title: 'AC-020 post', meta: futureLinkedMeta() } );
		mockBeehiivPosts( {
			testSend: { status: 422, body: { errors: [ { message: 'Daily test send limit reached' } ] } },
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		const section = testEmailSection( page );

		// Remembered and in the future.
		const future = Math.floor( Date.now() / 1000 ) + 4 * 3600;
		php( `update_option( "beehiiv_test_send_reset_at", [ "${ PUB }" => ${ future } ] );` );
		await sendFromUi( page, 'limit@example.com' );
		await expect( section ).toContainText( "You've used all test sends for today." );
		await expect( section ).toContainText( `They reset on ${ siteDate( future ) }` );

		// Remembered but already past: no time.
		const past = Math.floor( Date.now() / 1000 ) - 3600;
		php( `update_option( "beehiiv_test_send_reset_at", [ "${ PUB }" => ${ past } ] );` );
		await sendFromUi( page, 'limit@example.com' );
		await expect( section ).toContainText( "You've used all test sends for today." );
		await expect( section ).not.toContainText( 'They reset on' );

		// Nothing remembered: no time.
		php( 'delete_option( "beehiiv_test_send_reset_at" );' );
		await sendFromUi( page, 'limit@example.com' );
		await expect( section ).toContainText( "You've used all test sends for today." );
		await expect( section ).not.toContainText( 'They reset on' );
	} );

	test( 'AC-021: rate limiting shows "too many requests, try again in a moment"', async ( { page } ) => {
		const postId = createPost( { title: 'AC-021 post', meta: futureLinkedMeta() } );
		mockBeehiivPosts( { testSend: { status: 429, body: { message: 'Rate limited' } } } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await sendFromUi( page, 'rate@example.com' );
		await expect( testEmailSection( page ) ).toContainText( /too many requests\. try again in a moment\./i );
	} );

	test( "AC-022: other failures show a generic error including beehiiv's message", async ( { page } ) => {
		const postId = createPost( { title: 'AC-022 api post', meta: futureLinkedMeta() } );
		const beehiivMessage = 'Recipient list rejected by beehiiv';
		mockBeehiivPosts( {
			testSend: { status: 400, body: { errors: [ { message: beehiivMessage } ] } },
		} );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		await sendFromUi( page, 'other@example.com' );
		const section = testEmailSection( page );
		await expect( section ).toContainText( "The test email wasn't sent" );
		await expect( section ).toContainText( beehiivMessage );
	} );

	test( 'AC-022: content problems show the same message a real newsletter send would show', async ( { page } ) => {
		const postId = createPost( { title: 'AC-022 empty content', content: '' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		const realSendMessage = php( `
			$settings = \\Beehiiv\\Newsletter\\PostSettingsBuilder::get_post_settings( ${ postId } );
			echo is_wp_error( $settings ) ? \\Beehiiv\\Newsletter\\Sender::format_save_error_message( $settings ) : "NO_ERROR";
		` );
		expect( realSendMessage ).toBe( 'Add a title and body content before sending this newsletter.' );

		await sendFromUi( page, 'content@example.com' );
		await expect( testEmailSection( page ) ).toContainText( realSendMessage );
		expect( beehiivPostCalls( readHttpLog() ) ).toHaveLength( 0 );
	} );

	test( 'AC-023: typed addresses stay in the field after a failure', async ( { page } ) => {
		const postId = createPost( { title: 'AC-023 post', meta: futureLinkedMeta() } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );
		const typed = 'keep-one@example.com,\nkeep-two@example.com';

		for ( const testSend of [
			{ status: 500, body: { message: 'boom' } },
			{ status: 429, body: {} },
			{ status: 422, body: {} },
		] ) {
			mockBeehiivPosts( { testSend } );
			await sendFromUi( page, typed );
			await expect( testEmailSection( page ) ).not.toContainText( 'Test email sent.' );
			await expect( testEmailSection( page ).locator( '.components-notice' ) ).toBeVisible();
			await expect( recipientsField( page ) ).toHaveValue( typed );
		}

		// Client-side invalid-address failure too.
		await recipientsField( page ).fill( 'bad-address' );
		await sendButton( page ).click();
		await expect( testEmailSection( page ) ).toContainText( "aren't valid" );
		await expect( recipientsField( page ) ).toHaveValue( 'bad-address' );
	} );

	test( 'AC-024: temporary draft delete failure or "still processing" still counts as sent, with a leftover-draft note', async ( { page } ) => {
		const postId = createPost( { title: 'AC-024 post' } );
		await loginAsAdmin( page );
		await openBeehiivPanel( page, postId );

		for ( const del of [
			{ status: 202, body: '' },
			{ status: 500, body: { message: 'delete failed' } },
		] ) {
			mockBeehiivPosts( {
				testSend: { status: 200, body: { data: { remaining_test_sends: 3, reset_at: null } } },
				del,
			} );
			php( 'beehiiv_e2e_clear_http_log();' );
			const res = await sendFromUi( page, 'leftover@example.com' );
			expect( res.status(), `delete HTTP ${ del.status }` ).toBe( 200 );
			const section = testEmailSection( page );
			await expect( section ).toContainText( 'Test email sent.' );
			await expect( section ).toContainText( 'leftover test draft may still be in beehiiv' );
			expect( readHttpLog().some( ( e ) => e.mock === 'delete_post' ) ).toBe( true );
		}
	} );
} );
