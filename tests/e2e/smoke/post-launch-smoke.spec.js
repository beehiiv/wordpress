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
 * Automated equivalent of "beehiiv v1.1.0 | Post-launch Manual Smoke Tests"
 * (Google Sheet), cases SM-01 to SM-16. Run with `npm run test:smoke`.
 *
 * What this proves: the plugin builds and sends the right requests to
 * beehiiv, stores the right state in WordPress, and shows the right editor
 * UI. beehiiv is never contacted. The test-only mu-plugin
 * (tests/e2e/plugins/beehiiv-options.php, tests environment only) answers
 * every beehiiv call and logs it, so each test asserts on the exact payload.
 *
 * What it cannot prove (flagged per test with a `manual-only` annotation and
 * summarised in tests/e2e/smoke/README.md): anything that needs the real
 * beehiiv service or a real inbox -- received email content, the beehiiv
 * editor, real delivery timing, a real claimed ad, a real signup landing in a
 * publication, and the mobile layout of third-party embeds.
 */

const PUB = 'pub_smoke';
const TPL_DEFAULT = 'tpl_smoke_default';
const TPL_OTHER = 'tpl_smoke_other';
const CREATED_ID = 'post_smoke_created';
const LINKED_ID = 'post_smoke_linked';
const TMP_ID = 'post_smoke_tmp';
const AD_ID = 'ad_smoke_1';

const META = {
	send: '_beehiiv_send_to_newsletter',
	snippet: '_beehiiv_send_to_newsletter_snippet',
	postId: '_beehiiv_post_id',
	templateId: '_beehiiv_post_template_id',
	scheduledAt: '_beehiiv_scheduled_at',
	error: '_beehiiv_newsletter_error',
	title: '_beehiiv_newsletter_title',
	subtitle: '_beehiiv_newsletter_subtitle',
	show: '_beehiiv_newsletter_show_title_in_email',
};

const para = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const CONTENT = para( 'Smoke test body.' );
const DAY = 24 * 60 * 60 * 1000;

const createdPosts = [];
const createdPages = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const b64 = ( value ) =>
	Buffer.from( JSON.stringify( value ) ).toString( 'base64' );

/**
 * Runs PHP in the tests environment. `$a` holds the decoded payload.
 *
 * @param {Object} payload Values exposed to PHP as `$a`.
 * @param {string} code    PHP source, no opening tag.
 * @return {string} wp-cli output.
 */
function wpEvalWith( payload, code ) {
	return wpCli(
		`eval '$a = json_decode( base64_decode( "${ b64(
			payload
		) }" ), true ); ${ code }'`
	);
}

const lastLine = ( out ) => out.trim().split( '\n' ).pop().trim();

/**
 * Seeds a connected, ready-to-send site and registers HTTP mocks. Mocks are
 * matched in order, so specific ones go in `mocks`; a generic `/posts` mock
 * (create/update/delete succeed) is registered last.
 *
 * @param {Object} [options]
 * @param {boolean} [options.connected]
 * @param {Array}   [options.mocks]     `[ key, mock ]` pairs.
 * @param {string}  [options.timezone]  Site timezone string.
 * @param {Object}  [options.settings]  Extra plugin settings.
 */
function seed( {
	connected = true,
	mocks = [],
	timezone = '',
	settings = {},
} = {} ) {
	const all = [
		...mocks,
		[ '/posts', { body: { data: { id: CREATED_ID } } } ],
	];
	wpEvalWith(
		{ connected, mocks: all, timezone, settings },
		`beehiiv_e2e_reset_all();
		if ( $a["connected"] ) { beehiiv_e2e_seed_connection(); }
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		remove_all_filters( "sanitize_option_beehiiv_settings" );
		update_option( "beehiiv_settings", array_merge( [ "publication_id" => "${ PUB }", "post_template_id" => "${ TPL_DEFAULT }" ], $a["settings"] ) );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUB }", "name" => "Smoke Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUB }", [ [ "id" => "${ TPL_DEFAULT }", "name" => "Default template" ], [ "id" => "${ TPL_OTHER }", "name" => "Other template" ] ] );
		foreach ( $a["mocks"] as $m ) { beehiiv_e2e_mock_http( $m[0], $m[1] ); }
		update_option( "timezone_string", $a["timezone"] );
		update_option( "gmt_offset", 0 );
		delete_option( "beehiiv_test_send_reset_at" );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a post directly in the database (no REST, so no sync runs) and
 * empties the request log.
 *
 * @param {Object} options
 * @return {string} Post ID.
 */
function createPost( {
	title,
	content = CONTENT,
	status = 'draft',
	type = 'post',
	excerpt = '',
	meta = {},
	tags = [],
} ) {
	const id = lastLine(
		wpEvalWith(
			{
				post: {
					post_type: type,
					post_title: title,
					post_content: content,
					post_status: status,
					post_excerpt: excerpt,
					post_author: 1,
				},
				meta,
				tags,
			},
			`$id = wp_insert_post( $a["post"] );
			foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
			if ( ! empty( $a["tags"] ) ) { wp_set_post_tags( $id, $a["tags"] ); }
			beehiiv_e2e_clear_http_log();
			echo $id . "\\n";`
		)
	);
	( type === 'page' ? createdPages : createdPosts ).push( id );
	return id;
}

/**
 * Creates a post that is already linked to a beehiiv newsletter.
 *
 * @param {string} title
 * @param {Object} [options] Extra createPost options; `meta` merges.
 * @return {string} Post ID.
 */
function createLinkedPost( title, { meta = {}, ...rest } = {} ) {
	return createPost( {
		title,
		status: 'publish',
		meta: { [ META.postId ]: LINKED_ID, ...meta },
		...rest,
	} );
}

function getMeta( id ) {
	return JSON.parse(
		lastLine(
			wpCli(
				`eval '$m = get_post_meta( ${ id } ); $o = []; foreach ( $m as $k => $v ) { $o[ $k ] = $v[0]; } echo wp_json_encode( (object) $o ) . "\\n";'`
			)
		)
	);
}

function getLog() {
	return JSON.parse(
		lastLine( wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) ) || '[]'
	);
}

function clearLog() {
	wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
}

const isCreate = ( r ) =>
	r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url );
const creates = ( log ) => log.filter( isCreate );
const updates = ( log ) => log.filter( ( r ) => r.method === 'PATCH' );
const deletes = ( log ) => log.filter( ( r ) => r.method === 'DELETE' );
const beehiivCalls = ( log ) =>
	log.filter( ( r ) => ! /\/workspaces\/permissions/.test( r.url ) );

const isoGmt = ( msFromNow ) =>
	new Date( Date.now() + msFromNow ).toISOString().replace( /\.\d{3}Z$/, '' );
const isoUtc = ( msFromNow ) => `${ isoGmt( msFromNow ) }Z`;

/**
 * Logs in as admin and returns a REST caller bound to that session.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<Function>} `( method, path, data ) => { status, body }`
 */
async function restAs( page ) {
	await loginAsAdmin( page );
	const nonce = (
		await (
			await page.request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' )
		 ).text()
	).trim();
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
			// Non-JSON response.
		}
		return { status: res.status(), body };
	};
}

/** Mocks for the test-email endpoints (create temp draft, test_sends, get, delete). */
function testSendMocks( { testSend = {} } = {} ) {
	return [
		[
			'test_sends',
			{
				pattern: '#/publications/[^/]+/posts/[^/?]+/test_sends(\\?|$)#',
				method: 'POST',
				status: 200,
				body: { data: { remaining_test_sends: 4, reset_at: null } },
				...testSend,
			},
		],
		[
			'create_post',
			{
				pattern: '#/publications/[^/]+/posts(\\?|$)#',
				method: 'POST',
				status: 201,
				body: { data: { id: TMP_ID } },
			},
		],
		[
			'delete_post',
			{
				pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
				method: 'DELETE',
				status: 204,
				body: '',
			},
		],
		[
			'get_post',
			{
				pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
				method: 'GET',
				status: 200,
				body: { data: { id: TMP_ID } },
			},
		],
	];
}

/** POSTs to the test-send route from a block editor page (cookie + nonce). */
async function restTestSend( page, postId, recipients ) {
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
			} catch {
				// Non-JSON response.
			}
			return { status: res.status, body };
		},
		{ id: Number( postId ), to: recipients }
	);
}

async function openBeehiivPanel( page, postId ) {
	await loginAsAdmin( page );
	await openPostEditor( page, postId );
	const toggle = page
		.getByRole( 'button', { name: 'beehiiv', exact: true } )
		.first();
	await toggle.waitFor( { state: 'visible', timeout: 15000 } );
	const open =
		( await toggle.getAttribute( 'aria-expanded' ) ) === 'true' ||
		( await toggle.getAttribute( 'aria-pressed' ) ) === 'true';
	if ( ! open ) {
		await toggle.click();
	}
	await expect(
		page.locator( '.beehiiv-post-settings-content' )
	).toBeVisible();
}

const manualOnly = ( reason ) =>
	test.info().annotations.push( { type: 'manual-only', description: reason } );

// ---------------------------------------------------------------------------

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
	// A fresh tests environment can come back with no valid active theme, which
	// breaks the editor canvas and every frontend page these tests load.
	if ( wpCliSafe( 'theme is-active twentytwentyfive' ) === null ) {
		wpCli( 'theme activate twentytwentyfive' );
	}
} );

test.afterAll( () => {
	// Unlink first so deleting never tries to cancel a beehiiv newsletter.
	const ids = [ ...createdPosts, ...createdPages ];
	if ( ids.length ) {
		wpCliSafe(
			`eval 'foreach ( array( ${ ids.join(
				', '
			) } ) as $id ) { delete_post_meta( $id, "${
				META.postId
			}" ); wp_delete_post( $id, true ); }'`
		);
	}
	wpCliSafe(
		`eval 'update_option( "timezone_string", "" ); delete_option( "beehiiv_settings" ); delete_option( "beehiiv_ad_reservations" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'beehiiv v1.1.0 post-launch smoke tests', () => {
	test( 'SM-01 [P0] Upgrade + connection & settings', async ( { page } ) => {
		manualOnly(
			'The upgrade path from an older release on a real site, and a real OAuth connection, need manual testing. This test checks the installed build and that saved settings survive.'
		);
		seed();

		const version = lastLine(
			wpCli( 'plugin get beehiiv --field=version' )
		);
		const [ maj, min ] = version.split( '.' ).map( Number );
		expect( maj > 1 || ( maj === 1 && min >= 1 ) ).toBe( true );

		await loginAsAdmin( page );
		const response = await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		expect( response.status() ).toBe( 200 );
		const html = await page.content();
		expect( html ).not.toMatch( /Fatal error|Parse error|Uncaught/i );
		await expect( page.locator( '#wpbody-content' ) ).toBeVisible();

		// Connection, publication and template persist across a reload.
		await page.reload();
		const settings = JSON.parse(
			lastLine(
				wpCli(
					`eval 'echo wp_json_encode( get_option( "beehiiv_settings" ) );'`
				)
			)
		);
		expect( settings.publication_id ).toBe( PUB );
		expect( settings.post_template_id ).toBe( TPL_DEFAULT );
		expect(
			lastLine(
				wpCli(
					`eval 'echo \\Beehiiv\\Connection\\Manager::is_connected() ? "yes" : "no";'`
				)
			)
		).toBe( 'yes' );
	} );

	test( 'SM-02 [P0] Normal WordPress publish (no newsletter)', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( { title: 'Smoke SM-02' } );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );
		expect( res.body.status ).toBe( 'publish' );
		expect( beehiivCalls( getLog() ) ).toHaveLength( 0 );
		expect( getMeta( id )[ META.postId ] ).toBeUndefined();
	} );

	test( 'SM-03 [P0] Immediate newsletter publish/send', async ( {
		page,
	} ) => {
		manualOnly(
			'Delivery to a real test inbox, and the rendered email, need manual testing. This test checks the create-and-send request.'
		);
		seed();
		const id = createPost( {
			title: 'Smoke SM-03',
			meta: { [ META.send ]: '1' },
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const created = creates( getLog() );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ].url ).toContain( `/publications/${ PUB }/posts` );
		const body = created[ 0 ].body;
		expect( body.post_template_id ).toBe( TPL_DEFAULT );
		expect( body.status ).toBe( 'confirmed' );
		expect( body.scheduled_at ).toBeUndefined(); // Sent now.
		expect( JSON.stringify( body.blocks ) ).toContain( 'Smoke test body.' );
		expect( getMeta( id )[ META.postId ] ).toBe( CREATED_ID );
	} );

	test( 'SM-04 [P0] Newsletter title + subtitle mapping', async ( {
		page,
	} ) => {
		manualOnly(
			'Reading the subject and subtitle in the beehiiv editor and the received email needs manual testing. This test checks the persisted values and the request mapping.'
		);
		seed();
		const id = createPost( {
			title: 'Smoke SM-04 WP title',
			meta: { [ META.send ]: '1' },
		} );
		const rest = await restAs( page );

		// Save and reopen: title and subtitle persist.
		const saved = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			meta: {
				[ META.title ]: 'Smoke SM-04 email subject',
				[ META.subtitle ]: 'Smoke SM-04 subtitle',
			},
		} );
		expect( saved.status ).toBe( 200 );
		const reopened = await rest(
			'GET',
			`/wp/v2/posts/${ id }?context=edit`
		);
		expect( reopened.body.meta[ META.title ] ).toBe(
			'Smoke SM-04 email subject'
		);
		expect( reopened.body.meta[ META.subtitle ] ).toBe(
			'Smoke SM-04 subtitle'
		);
		expect( beehiivCalls( getLog() ) ).toHaveLength( 0 ); // Drafts do not sync.

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const body = creates( getLog() )[ 0 ].body;
		expect( body.email_settings.email_subject_line ).toBe(
			'Smoke SM-04 email subject'
		);
		expect( body.subtitle ).toBe( 'Smoke SM-04 subtitle' );
		expect( body.title ).toBe( 'Smoke SM-04 WP title' );
		// Preview text is not auto-populated from the subtitle.
		expect( body.email_settings.preview_text ).toBeUndefined();
	} );

	test( 'SM-05 [P1] Title fallback + special characters', async ( {
		page,
	} ) => {
		seed();
		const rest = await restAs( page );

		const fallbackId = createPost( {
			title: 'Smoke SM-05 fallback title',
			meta: { [ META.send ]: '1' },
		} );
		await rest( 'POST', `/wp/v2/posts/${ fallbackId }`, {
			status: 'publish',
		} );
		let body = creates( getLog() )[ 0 ].body;
		expect( body.email_settings.email_subject_line ).toBe(
			'Smoke SM-05 fallback title'
		);
		expect( body.subtitle ).toBeUndefined();

		clearLog();
		const special = {
			title: 'Fish & Chips: "quotes", it\'s 50% off — café ✓',
			subtitle: 'Q&A — it\'s "great" & more… 日本語',
		};
		const specialId = createPost( {
			title: 'Smoke SM-05 special',
			meta: {
				[ META.send ]: '1',
				[ META.title ]: special.title,
				[ META.subtitle ]: special.subtitle,
			},
		} );
		await rest( 'POST', `/wp/v2/posts/${ specialId }`, {
			status: 'publish',
		} );
		body = creates( getLog() )[ 0 ].body;
		expect( body.email_settings.email_subject_line ).toBe( special.title );
		expect( body.subtitle ).toBe( special.subtitle );
		expect( body.email_settings.email_subject_line ).not.toMatch(
			/&amp;|&quot;|&#0?39;|\\u/
		);
	} );

	test( 'SM-06 [P0] Show title/subtitle in email: OFF / ON', async ( {
		page,
	} ) => {
		manualOnly(
			'What the received email actually looks like (including no unexpected byline) needs manual testing. This test checks the flag sent to beehiiv and that it persists.'
		);
		seed();
		const rest = await restAs( page );

		// Default is OFF for an unsent newsletter.
		const offId = createPost( {
			title: 'Smoke SM-06 off',
			meta: {
				[ META.send ]: '1',
				[ META.title ]: 'Smoke SM-06 subject',
				[ META.subtitle ]: 'Smoke SM-06 subtitle',
			},
		} );
		const defaults = await rest(
			'GET',
			`/wp/v2/posts/${ offId }?context=edit`
		);
		expect( [ false, '', 0, undefined, null ] ).toContain(
			defaults.body.meta[ META.show ]
		);
		await rest( 'POST', `/wp/v2/posts/${ offId }`, { status: 'publish' } );
		let email = creates( getLog() )[ 0 ].body.email_settings;
		expect( email.email_subject_line ).toBe( 'Smoke SM-06 subject' );
		expect( email.display_title_in_email ).toBe( false );
		expect( email.display_subtitle_in_email ).toBe( false );
		expect( email.display_byline_in_email ).toBe( false );

		// ON: saved, persists on reload, and is sent.
		clearLog();
		const onId = createPost( {
			title: 'Smoke SM-06 on',
			meta: {
				[ META.send ]: '1',
				[ META.title ]: 'Smoke SM-06 subject',
				[ META.subtitle ]: 'Smoke SM-06 subtitle',
			},
		} );
		await rest( 'POST', `/wp/v2/posts/${ onId }`, {
			meta: { [ META.show ]: true },
		} );
		const reloaded = await rest(
			'GET',
			`/wp/v2/posts/${ onId }?context=edit`
		);
		expect( reloaded.body.meta[ META.show ] ).toBe( true );
		await rest( 'POST', `/wp/v2/posts/${ onId }`, { status: 'publish' } );
		email = creates( getLog() )[ 0 ].body.email_settings;
		expect( email.email_subject_line ).toBe( 'Smoke SM-06 subject' );
		expect( email.display_title_in_email ).toBe( true );
		expect( email.display_subtitle_in_email ).toBe( true );
		expect( email.display_byline_in_email ).toBe( false );
	} );

	test( 'SM-07 [P1] Tags + excerpt / metadata sync', async ( { page } ) => {
		manualOnly(
			'Confirming the fields in the real beehiiv dashboard, and that nothing leaks into the email body or Read Online page, needs manual testing.'
		);
		seed();
		const id = createPost( {
			title: 'Smoke SM-07',
			excerpt: 'Smoke SM-07 custom excerpt for search engines.',
			tags: [ 'smoke-alpha', 'smoke-beta' ],
			meta: { [ META.send ]: '1' },
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const body = creates( getLog() )[ 0 ].body;
		expect( body.content_tags ).toEqual(
			expect.arrayContaining( [ 'smoke-alpha', 'smoke-beta' ] )
		);
		expect( body.seo_settings ).toBeTruthy();
		expect( JSON.stringify( body.seo_settings ) ).toContain(
			'Smoke SM-07 custom excerpt'
		);
		expect( body.web_settings.slug ).toContain( 'smoke-sm-07' );
		// The excerpt is metadata only: it is not part of the content blocks.
		expect( JSON.stringify( body.blocks ) ).not.toContain(
			'Smoke SM-07 custom excerpt'
		);

		// No retroactive update after the send: later tag edits send nothing.
		wpEvalWith(
			{ id },
			`wp_set_post_tags( $a["id"], [ "smoke-late" ] ); update_post_meta( $a["id"], "${ META.scheduledAt }", "" );`
		);
		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			status: 'publish',
			excerpt: 'Edited after send.',
		} );
		expect( creates( getLog() ) ).toHaveLength( 0 );
	} );

	test( 'SM-08 [P1] Full and snippet newsletters', async ( { page } ) => {
		manualOnly(
			'That the Read More link opens the real full article from a received email needs manual testing. This test checks the blocks and the button URL.'
		);
		seed();
		const rest = await restAs( page );
		const content =
			para( 'Before the break.' ) +
			'<!-- wp:more --><!--more--><!-- /wp:more -->' +
			para( 'After the break.' );

		const fullId = createPost( {
			title: 'Smoke SM-08 full',
			content,
			meta: { [ META.send ]: '1' },
		} );
		await rest( 'POST', `/wp/v2/posts/${ fullId }`, { status: 'publish' } );
		let blocks = JSON.stringify( creates( getLog() )[ 0 ].body.blocks );
		expect( blocks ).toContain( 'Before the break.' );
		expect( blocks ).toContain( 'After the break.' );
		expect( blocks ).not.toContain( 'Read More' );

		clearLog();
		const snippetId = createPost( {
			title: 'Smoke SM-08 snippet',
			content,
			meta: { [ META.send ]: '1', [ META.snippet ]: '1' },
		} );
		await rest( 'POST', `/wp/v2/posts/${ snippetId }`, {
			status: 'publish',
		} );
		blocks = JSON.stringify( creates( getLog() )[ 0 ].body.blocks );
		expect( blocks ).toContain( 'Before the break.' );
		expect( blocks ).not.toContain( 'After the break.' );
		expect( blocks ).toContain( 'Read More' );
		const permalink = lastLine(
			wpCli( `eval 'echo get_permalink( ${ snippetId } );'` )
		);
		expect( blocks ).toContain( JSON.stringify( permalink ).slice( 1, -1 ) );
		const link = await page.request.get( permalink );
		expect( link.status() ).toBe( 200 );
	} );

	test( 'SM-09 [P0] Schedule & edit unsent newsletter', async ( { page } ) => {
		manualOnly(
			'That beehiiv really sends at the scheduled time (and only once) can only be confirmed later against the real service.'
		);
		seed( { timezone: 'America/New_York' } );
		const id = createPost( {
			title: 'Smoke SM-09',
			meta: { [ META.send ]: '1', [ META.title ]: 'Smoke SM-09 subject' },
		} );
		const rest = await restAs( page );
		const future = isoGmt( 3 * DAY );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			status: 'future',
			date_gmt: future,
		} );
		expect( res.body.status ).toBe( 'future' );
		let created = creates( getLog() );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ].body.scheduled_at ).toBe( `${ future }Z` );
		expect( getMeta( id )[ META.scheduledAt ] ).toBe( `${ future }Z` );

		// Edit title/subtitle before it sends: updates the same newsletter in place.
		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			meta: {
				[ META.title ]: 'Smoke SM-09 edited subject',
				[ META.subtitle ]: 'Smoke SM-09 edited subtitle',
			},
		} );
		const log = getLog();
		expect( creates( log ) ).toHaveLength( 0 ); // No duplicate.
		expect( updates( log ) ).toHaveLength( 1 );
		expect( updates( log )[ 0 ].url ).toContain( CREATED_ID );
		expect(
			updates( log )[ 0 ].body.email_settings.email_subject_line
		).toBe( 'Smoke SM-09 edited subject' );
		expect( updates( log )[ 0 ].body.subtitle ).toBe(
			'Smoke SM-09 edited subtitle'
		);
		const meta = getMeta( id );
		expect( meta[ META.title ] ).toBe( 'Smoke SM-09 edited subject' );
		expect( meta[ META.scheduledAt ] ).toBe( `${ future }Z` ); // Not sent early.
		expect(
			lastLine(
				wpCli( `eval 'echo get_post_status( ${ id } );'` )
			)
		).toBe( 'future' );
	} );

	test( 'SM-10 [P0] Send Test Email: eligible post statuses', async ( {
		page,
	} ) => {
		manualOnly(
			'Receiving the test email in a real inbox needs manual testing. This test checks the request to beehiiv and that the post state is unchanged.'
		);
		seed( { mocks: testSendMocks() } );
		const ids = {
			draft: createPost( { title: 'Smoke SM-10 draft' } ),
			pending: createPost( {
				title: 'Smoke SM-10 pending',
				status: 'pending',
			} ),
			future: createPost( {
				title: 'Smoke SM-10 scheduled',
				status: 'future',
				meta: {},
			} ),
		};
		// A scheduled post needs a future date.
		wpEvalWith(
			{ id: ids.future },
			`wp_update_post( [ "ID" => $a["id"], "post_status" => "future", "post_date" => wp_date( "Y-m-d H:i:s", time() + 3 * DAY_IN_SECONDS ), "post_date_gmt" => gmdate( "Y-m-d H:i:s", time() + 3 * DAY_IN_SECONDS ) ] );`
		);

		await loginAsAdmin( page );
		await page.goto( `/wp-admin/post.php?post=${ ids.draft }&action=edit` );
		await page.waitForFunction( () => window.wpApiSettings );

		for ( const [ status, id ] of Object.entries( ids ) ) {
			clearLog();
			const res = await restTestSend( page, id, 'qa@example.com' );
			expect( res.status, `${ status } status` ).toBe( 200 );

			const log = beehiivCalls( getLog() );
			const sends = log.filter( ( r ) => /\/test_sends/.test( r.url ) );
			expect( sends ).toHaveLength( 1 );
			expect( JSON.stringify( sends[ 0 ].body ) ).toContain(
				'qa@example.com'
			);
			// The temporary draft is created as a draft, never confirmed/scheduled.
			const tmp = creates( log )[ 0 ].body;
			expect( tmp.status ).toBe( 'draft' );
			expect( tmp.scheduled_at ).toBeUndefined();
			expect( deletes( log ) ).toHaveLength( 1 ); // Cleaned up.
			expect( getMeta( id )[ META.postId ] ).toBeUndefined(); // Not linked.
			expect(
				lastLine( wpCli( `eval 'echo get_post_status( ${ id } );'` ) )
			).toBe( status === 'future' ? 'future' : status );
		}

		// Published posts are not eligible.
		const pub = createPost( { title: 'Smoke SM-10 published', status: 'publish' } );
		const rejected = await restTestSend( page, pub, 'qa@example.com' );
		expect( rejected.status ).toBe( 400 );
		expect( rejected.body.code ).toBe( 'beehiiv_test_send_ineligible_status' );
	} );

	test( 'SM-11 [P1] Test-email recipients & validation', async ( { page } ) => {
		manualOnly(
			'Only addresses controlled by QA can confirm real delivery; this test checks parsing and validation.'
		);
		seed( { mocks: testSendMocks() } );
		const id = createPost( { title: 'Smoke SM-11' } );
		await loginAsAdmin( page );
		await page.goto( `/wp-admin/post.php?post=${ id }&action=edit` );
		await page.waitForFunction( () => window.wpApiSettings );

		// Commas/newlines, spaces, case-insensitive duplicates.
		const ok = await restTestSend(
			page,
			id,
			' a@example.com ,\nb@example.com,  A@EXAMPLE.COM\n\n, c@example.com '
		);
		expect( ok.status ).toBe( 200 );
		const sent = getLog().find( ( r ) => /\/test_sends/.test( r.url ) );
		expect( JSON.stringify( sent.body ) ).toContain( 'a@example.com' );
		const payload = JSON.stringify( sent.body );
		expect( payload ).not.toContain( 'A@EXAMPLE.COM' );
		expect( ( payload.match( /@example\.com/g ) || [] ).length ).toBe( 3 );

		// An invalid address is identified and blocks the whole send.
		clearLog();
		const bad = await restTestSend(
			page,
			id,
			'good@example.com, not-an-email'
		);
		expect( bad.status ).toBe( 400 );
		expect( bad.body.code ).toBe( 'beehiiv_test_send_invalid_recipients' );
		expect( bad.body.message ).toContain( 'not-an-email' );
		expect( beehiivCalls( getLog() ) ).toHaveLength( 0 );

		// Empty recipients are rejected; valid recipients work again.
		const none = await restTestSend( page, id, ' , \n ' );
		expect( none.body.code ).toBe( 'beehiiv_test_send_no_recipients' );
		const again = await restTestSend( page, id, 'good@example.com' );
		expect( again.status ).toBe( 200 );
	} );

	test( 'SM-12 [P0] Test-send safety & state', async ( { page } ) => {
		manualOnly(
			'Checking the temporary draft is gone in the real beehiiv account, and the real send state, needs manual testing.'
		);
		seed( { mocks: testSendMocks() } );
		const unlinked = createPost( { title: 'Smoke SM-12 unlinked' } );
		const linkedFuture = createPost( {
			title: 'Smoke SM-12 linked',
			status: 'future',
			meta: {
				[ META.postId ]: LINKED_ID,
				[ META.send ]: '1',
				[ META.scheduledAt ]: isoUtc( 2 * DAY ),
			},
		} );
		wpEvalWith(
			{ id: linkedFuture },
			`wp_update_post( [ "ID" => $a["id"], "post_status" => "future", "post_date" => wp_date( "Y-m-d H:i:s", time() + 2 * DAY_IN_SECONDS ), "post_date_gmt" => gmdate( "Y-m-d H:i:s", time() + 2 * DAY_IN_SECONDS ) ] );`
		);

		// UI: button is disabled with unsaved edits, enabled once saved.
		await openBeehiivPanel( page, unlinked );
		const button = page.getByRole( 'button', {
			name: 'Send test email',
			exact: true,
		} );
		await page.getByLabel( 'Send test email to' ).fill( 'qa@example.com' );
		await expect( button ).toBeVisible();
		await expect( button ).toBeEnabled();

		await page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.getByRole( 'document', { name: /Block: (Paragraph|Title)/ } )
			.first()
			.click();
		await page.keyboard.type( ' unsaved edit' );
		const disabled = async () =>
			( await button.getAttribute( 'aria-disabled' ) ) === 'true' ||
			( await button.isDisabled() );
		await expect.poll( disabled ).toBe( true ); // Unsaved edits.

		const saved = page.waitForResponse(
			( res ) =>
				/\/wp-json\/wp\/v2\/posts\/\d+/.test( res.url() ) &&
				res.request().method() !== 'GET'
		);
		await page.getByRole( 'button', { name: 'Save draft' } ).click();
		await saved;
		await expect.poll( disabled ).toBe( false ); // Saved again.

		// A test send for an unlinked draft: temp draft created, sent, deleted.
		clearLog();
		const first = await restTestSend( page, unlinked, 'qa@example.com' );
		expect( first.status ).toBe( 200 );
		let log = getLog();
		expect( creates( log ) ).toHaveLength( 1 );
		expect( creates( log )[ 0 ].body.status ).toBe( 'draft' );
		expect( deletes( log ) ).toHaveLength( 1 );
		expect( getMeta( unlinked )[ META.postId ] ).toBeUndefined();
		expect(
			lastLine( wpCli( `eval 'echo get_post_status( ${ unlinked } );'` ) )
		).toBe( 'draft' );

		// A linked, unsent newsletter: still never publishes or reschedules it.
		clearLog();
		const linked = await restTestSend( page, linkedFuture, 'qa@example.com' );
		expect( linked.status ).toBe( 200 );
		log = getLog();
		expect( updates( log ) ).toHaveLength( 0 );
		expect( deletes( log ).every( ( r ) => r.url.includes( TMP_ID ) ) ).toBe(
			true
		);
		const meta = getMeta( linkedFuture );
		expect( meta[ META.postId ] ).toBe( LINKED_ID );
		expect( meta[ META.scheduledAt ] ).toBeTruthy();

		// A hostile filter forcing "confirmed" is overridden: temp draft stays a draft.
		wpCli( `eval 'update_option( "beehiiv_e2e_force_settings_status", "confirmed" );'` );
		clearLog();
		await restTestSend( page, unlinked, 'qa@example.com' );
		const forced = creates( getLog() )[ 0 ].body;
		expect( forced.status ).toBe( 'draft' );
		expect( forced.scheduled_at ).toBeUndefined();
		wpCli( `eval 'delete_option( "beehiiv_e2e_force_settings_status" );'` );

		// A failed send reports an error, cleans up, and can be retried.
		seed( {
			mocks: testSendMocks( {
				testSend: { status: 500, body: { message: 'boom' } },
			} ),
		} );
		const failed = await restTestSend( page, unlinked, 'qa@example.com' );
		expect( failed.status ).toBe( 400 );
		expect( deletes( getLog() ) ).toHaveLength( 1 );
		seed( { mocks: testSendMocks() } );
		const retry = await restTestSend( page, unlinked, 'qa@example.com' );
		expect( retry.status ).toBe( 200 );
	} );

	test( 'SM-13 [P0] Already sent / post-update regression', async ( {
		page,
	} ) => {
		manualOnly(
			'That the already-sent newsletter is untouched in the real beehiiv account needs manual testing. This test checks that the plugin sends no changes and blocks a second send.'
		);
		seed( {
			mocks: [
				[
					'get_sent',
					{
						pattern: '#/publications/[^/]+/posts/[^/?]+(\\?|$)#',
						method: 'GET',
						status: 200,
						body: {
							data: {
								id: LINKED_ID,
								status: 'confirmed',
								publish_date: Math.floor( Date.now() / 1000 ) - 86400,
							},
						},
					},
				],
			],
		} );
		const id = createLinkedPost( 'Smoke SM-13', {
			meta: {
				[ META.send ]: '',
				[ META.scheduledAt ]: isoUtc( -2 * DAY ),
				[ META.title ]: 'Smoke SM-13 subject',
				'_beehiiv_newsletter_sent': '1',
			},
			excerpt: 'Original excerpt',
			tags: [ 'smoke-sent' ],
		} );

		// The editor locks "Send to newsletter" for a sent newsletter.
		await openBeehiivPanel( page, id );
		await expect(
			page.getByRole( 'checkbox', { name: 'Send to newsletter' } )
		).toBeDisabled();

		// Editing the WordPress post sends nothing to beehiiv, and a locked
		// newsletter field cannot be changed afterwards.
		const rest = await restAs( page );
		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			title: 'Smoke SM-13 edited title',
			excerpt: 'Edited excerpt',
			meta: {
				[ META.title ]: 'Smoke SM-13 changed subject',
				[ META.subtitle ]: 'Smoke SM-13 changed subtitle',
			},
		} );
		expect( res.status ).toBeLessThan( 500 );
		const log = getLog();
		expect( creates( log ) ).toHaveLength( 0 ); // No duplicate email.
		expect( updates( log ) ).toHaveLength( 0 ); // Sent newsletter untouched.
		expect( deletes( log ) ).toHaveLength( 0 );
		expect( getMeta( id )[ META.postId ] ).toBe( LINKED_ID );

		// A test email is refused for a sent newsletter.
		const refused = await restTestSend( page, id, 'qa@example.com' );
		expect( refused.status ).toBe( 400 );
	} );

	test( 'SM-14 [P1] Subscribe Form: visitor signup', async ( {
		page,
		browser,
	} ) => {
		manualOnly(
			'A real signup landing in the right beehiiv publication, and the mobile layout of the live beehiiv form, need manual testing. This test checks the block renders on the frontend for a logged-out visitor and loads the beehiiv form script with the right form ID.'
		);
		const FORM_ID = 'smoke-form-0000-1111';
		seed();
		const content = `<!-- wp:beehiiv/subscribe-form {"formId":"${ FORM_ID }"} /-->`;
		const id = createPost( {
			title: 'Smoke SM-14 form page',
			type: 'page',
			status: 'publish',
			content,
		} );
		const url = lastLine(
			wpCli( `eval 'echo get_permalink( ${ id } );'` )
		).replace( /^https?:\/\/[^/]+/, '' );

		for ( const viewport of [
			{ width: 1280, height: 800 },
			{ width: 375, height: 812 },
		] ) {
			const context = await browser.newContext( { viewport } ); // Logged out.
			const visitor = await context.newPage();
			await visitor.goto( `${ test.info().project.use.baseURL || '' }${ url }` );
			const script = visitor.locator(
				`script[data-beehiiv-form="${ FORM_ID }"]`
			);
			await expect( script ).toHaveCount( 1 );
			await expect( script ).toHaveAttribute(
				'src',
				'https://subscribe-forms.beehiiv.com/v3/loader.js'
			);
			// No horizontal overflow at either width.
			const overflow = await visitor.evaluate(
				() =>
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth
			);
			expect( overflow ).toBe( false );
			await context.close();
		}

		// An empty form ID renders nothing.
		const emptyId = createPost( {
			title: 'Smoke SM-14 empty form',
			type: 'page',
			status: 'publish',
			content: '<!-- wp:beehiiv/subscribe-form /-->',
		} );
		const emptyUrl = lastLine(
			wpCli( `eval 'echo get_permalink( ${ emptyId } );'` )
		);
		const html = await ( await page.request.get( emptyUrl ) ).text();
		expect( html ).not.toContain( 'data-beehiiv-form' );
	} );

	test( 'SM-15 [P1] Advertisement Block: newsletter', async ( { page } ) => {
		manualOnly(
			'Needs a real claimed ad in a real beehiiv account: it cannot confirm the ad appears in the received email. This test uses a mocked active ad and checks the payload, persistence, frontend and one-per-post rule.'
		);
		const adMock = [
			'/advertisement_opportunities',
			{
				body: {
					data: [
						{
							id: AD_ID,
							advertiser_name: 'Smoke Advertiser',
							payout_rate: '1.00',
							advertisement_kind: 'sponsored',
						},
					],
				},
			},
		];
		seed( { mocks: [ adMock ] } );
		const adBlock = `<!-- wp:beehiiv/advertisement {"adId":"${ AD_ID }","adLabel":"Smoke Advertiser"} /-->`;
		const id = createPost( {
			title: 'Smoke SM-15',
			content: para( 'Before the ad.' ) + adBlock + para( 'After the ad.' ),
			meta: { [ META.send ]: '1' },
		} );
		const rest = await restAs( page );

		// Save and reopen: the selected ad persists in the content.
		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			content: para( 'Before the ad.' ) + adBlock + para( 'After the ad.' ),
		} );
		const reopened = await rest( 'GET', `/wp/v2/posts/${ id }?context=edit` );
		expect( reopened.body.content.raw ).toContain( AD_ID );

		// Only one block allowed.
		const supports = JSON.parse(
			lastLine(
				wpCli(
					`eval 'echo wp_json_encode( WP_Block_Type_Registry::get_instance()->get_registered( "beehiiv/advertisement" )->supports );'`
				)
			)
		);
		expect( supports.multiple ).toBe( false );

		// Appears in the newsletter payload, not on the WP frontend.
		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const body = creates( getLog() )[ 0 ].body;
		const ads = body.blocks.filter( ( b ) => b.type === 'advertisement' );
		expect( ads ).toHaveLength( 1 );
		expect( ads[ 0 ].opportunity_id ).toBe( AD_ID );
		const permalink = lastLine(
			wpCli( `eval 'echo get_permalink( ${ id } );'` )
		);
		const html = await ( await page.request.get( permalink ) ).text();
		expect( html ).toContain( 'Before the ad.' );
		expect( html ).not.toContain( AD_ID );
		expect( html ).not.toContain( 'Smoke Advertiser' );

		// An ad block with no ad selected is blocked, not sent.
		clearLog();
		const emptyAdId = createPost( {
			title: 'Smoke SM-15 no ad',
			content: para( 'Body.' ) + '<!-- wp:beehiiv/advertisement /-->',
			meta: { [ META.send ]: '1' },
		} );
		await rest( 'POST', `/wp/v2/posts/${ emptyAdId }`, {
			status: 'publish',
		} );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		expect( getMeta( emptyAdId )[ META.error ] ).toBeTruthy();
	} );

	test( 'SM-16 [P1] Template override + safe errors', async ( { page } ) => {
		manualOnly(
			'That the chosen template visibly changes the real email design needs manual testing. This test checks which template ID is sent.'
		);
		seed();
		const rest = await restAs( page );

		const defaultId = createPost( {
			title: 'Smoke SM-16 default',
			meta: { [ META.send ]: '1' },
		} );
		await rest( 'POST', `/wp/v2/posts/${ defaultId }`, {
			status: 'publish',
		} );
		expect( creates( getLog() )[ 0 ].body.post_template_id ).toBe(
			TPL_DEFAULT
		);

		clearLog();
		const overrideId = createPost( {
			title: 'Smoke SM-16 override',
			meta: { [ META.send ]: '1', [ META.templateId ]: TPL_OTHER },
		} );
		await rest( 'POST', `/wp/v2/posts/${ overrideId }`, {
			status: 'publish',
		} );
		expect( creates( getLog() )[ 0 ].body.post_template_id ).toBe(
			TPL_OTHER
		);

		// Empty content and unsupported-only content: clear error, never marked sent.
		for ( const [ label, content ] of [
			[ 'empty', '' ],
			[
				'unsupported',
				'<!-- wp:html --><div>Only custom HTML</div><!-- /wp:html -->',
			],
		] ) {
			clearLog();
			const id = createPost( {
				title: `Smoke SM-16 ${ label }`,
				content,
				meta: { [ META.send ]: '1' },
			} );
			await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
			expect( creates( getLog() ), label ).toHaveLength( 0 );
			const meta = getMeta( id );
			expect( meta[ META.error ], label ).toBeTruthy();
			expect( meta[ META.postId ], label ).toBeUndefined();
			expect( meta._beehiiv_newsletter_sent, label ).toBeUndefined();
		}
	} );
} );
