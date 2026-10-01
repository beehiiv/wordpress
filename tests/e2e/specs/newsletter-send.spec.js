const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { openPostEditor, openBeehiivSidebar } = require( '../utils/editor' );
const { wpCli, wpCliSafe, ensurePluginActive, ensurePrettyPermalinks } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/1-newsletter-send/newsletter-send.prd.md (v1.3)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/Sender.php -- lifecycle hooks (REST insert,
 *   status transitions, delete), send/update/reschedule/cancel, error meta.
 * - includes/Newsletter/PostSettingsBuilder.php -- create/update payloads,
 *   subject line/subtitle/display choice, scheduled_at (UTC) and validation.
 * - includes/Editor/Meta.php -- post meta keys.
 *
 * Every save goes through the same REST endpoint the block editor uses
 * (POST /wp/v2/posts/{id}, cookie + nonce), which is what fires
 * `rest_after_insert_post`. Every outbound beehiiv request is answered by
 * the test-only `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php
 * and recorded in its request log, so specs assert on the exact payload the
 * plugin sent to beehiiv. Nothing reaches the live API.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	sendDate: '_beehiiv_send_to_newsletter_date',
	postId: '_beehiiv_post_id',
	scheduledAt: '_beehiiv_scheduled_at',
	error: '_beehiiv_newsletter_error',
	errorType: '_beehiiv_newsletter_error_type',
	title: '_beehiiv_newsletter_title',
	subtitle: '_beehiiv_newsletter_subtitle',
	show: '_beehiiv_newsletter_show_title_in_email',
};

const PUBLICATION_ID = 'pub_qa_e2e_send';
const TEMPLATE_ID = 'tpl_qa_e2e_send';
const MOCK_CREATED_ID = 'post_qa_e2e_created';
const LINKED_ID = 'post_qa_e2e_linked';
const CONTENT = '<!-- wp:paragraph --><p>QA E2E newsletter body.</p><!-- /wp:paragraph -->';

const createdPosts = [];

const b64 = ( value ) => Buffer.from( JSON.stringify( value ) ).toString( 'base64' );

/** Runs PHP inside the tests env; the payload travels base64-encoded so no quoting issues. */
function wpEvalWith( payload, php ) {
	return wpCli( `eval '$a = json_decode( base64_decode( "${ b64( payload ) }" ), true ); ${ php }'` );
}

/**
 * Resets beehiiv seams and seeds a "ready to send" site (connected,
 * publication + default template configured), then registers HTTP mocks in
 * order (first match wins). The generic `/posts` mock (create/update/delete
 * all succeed, create returns MOCK_CREATED_ID) is always registered last.
 */
function seed( { connected = true, publication = PUBLICATION_ID, mocks = [], postsMock = null, timezone = '' } = {} ) {
	const allMocks = [
		...mocks,
		[ '/posts', postsMock || { body: { data: { id: MOCK_CREATED_ID } } } ],
	];
	wpEvalWith(
		{ connected, publication, mocks: allMocks, timezone },
		`beehiiv_e2e_reset_all();
		if ( $a["connected"] ) { beehiiv_e2e_seed_connection(); }
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => $a["publication"], "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "QA E2E Template" ] ] );
		foreach ( $a["mocks"] as $m ) { beehiiv_e2e_mock_http( $m[0], $m[1] ); }
		update_option( "timezone_string", $a["timezone"] );
		update_option( "gmt_offset", 0 );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a post fixture directly in the DB, then sets its meta/tags and
 * empties the request log so only the action under test is recorded.
 */
function createPost( { title, type = 'post', status = 'draft', dateGmt = null, excerpt = '', meta = {}, tags = [], extra = {} } ) {
	const post = {
		post_type: type,
		post_title: title,
		post_content: CONTENT,
		post_status: status,
		post_excerpt: excerpt,
		post_author: 1,
		...extra,
	};
	if ( dateGmt ) {
		post.post_date_gmt = dateGmt;
		post.post_date = dateGmt; // Site timezone is UTC unless a test changes it afterwards.
	}
	const id = wpEvalWith(
		{ post, meta, tags },
		`$id = wp_insert_post( $a["post"] );
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		if ( ! empty( $a["tags"] ) ) { wp_set_post_tags( $id, $a["tags"] ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	return id;
}

/** Creates a published post already linked to a beehiiv newsletter. */
function createLinkedPost( title, { meta = {}, ...rest } = {} ) {
	return createPost( {
		title,
		status: 'publish',
		meta: { [ META.postId ]: LINKED_ID, [ META.send ]: '', ...meta },
		...rest,
	} );
}

function getLog() {
	return JSON.parse( wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]' );
}

function clearLog() {
	wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
}

/** All meta for a post, single values. */
function getMeta( id ) {
	const raw = wpCli(
		`eval '$m = get_post_meta( ${ id } ); $o = []; foreach ( $m as $k => $v ) { $o[ $k ] = $v[0]; } echo wp_json_encode( (object) $o ) . "\\n";'`
	);
	return JSON.parse( raw );
}

const creates = ( log ) => log.filter( ( r ) => r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url ) );
const updates = ( log ) => log.filter( ( r ) => r.method === 'PATCH' );
const deletes = ( log ) => log.filter( ( r ) => r.method === 'DELETE' );

function isoGmt( msFromNow ) {
	return new Date( Date.now() + msFromNow ).toISOString().replace( /\.\d{3}Z$/, '' );
}
const DAY = 24 * 60 * 60 * 1000;

/** Collects every [key, value] pair in a nested payload. */
function entries( obj, out = [] ) {
	if ( obj && typeof obj === 'object' ) {
		for ( const [ k, v ] of Object.entries( obj ) ) {
			out.push( [ k, v ] );
			entries( v, out );
		}
	}
	return out;
}

/** Logs in as admin and returns a REST caller bound to that session (cookie + nonce). */
async function restAs( page ) {
	await loginAsAdmin( page );
	const nonceRes = await page.request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' );
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
		} catch ( e ) {}
		return { status: res.status(), body };
	};
}

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
} );

test.afterAll( async () => {
	// Unlink first so deleting never tries to cancel a beehiiv newsletter.
	wpCliSafe(
		`eval 'foreach ( array( ${ createdPosts.join( ', ' ) } ) as $id ) { delete_post_meta( $id, "${ META.postId }" ); wp_delete_post( $id, true ); }
		update_option( "timezone_string", "" ); update_option( "gmt_offset", 0 );
		delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: send published posts', () => {
	test( 'AC-001: publishing a post with "Send to Newsletter" on creates the beehiiv newsletter', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-001', meta: { [ META.send ]: '1' } } );
		const offId = createPost( { title: 'QA E2E send AC-001 (toggle off)' } );
		const rest = await restAs( page );

		expect( ( await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } ) ).status ).toBe( 200 );
		const log = getLog();
		expect( creates( log ) ).toHaveLength( 1 );
		expect( creates( log )[ 0 ].url ).toContain( `/publications/${ PUBLICATION_ID }/posts` );
		expect( getMeta( id )[ META.postId ] ).toBe( MOCK_CREATED_ID );

		// Control: the same publish with the toggle off sends nothing.
		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ offId }`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		expect( getMeta( offId )[ META.postId ] ).toBeUndefined();
	} );

	test( 'AC-002: only the "post" post type sends newsletters', async ( { page } ) => {
		seed();
		const pageId = createPost( { title: 'QA E2E send AC-002 page', type: 'page', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		expect( ( await rest( 'POST', `/wp/v2/pages/${ pageId }`, { status: 'publish' } ) ).status ).toBe( 200 );
		expect( getLog() ).toHaveLength( 0 );
		expect( getMeta( pageId )[ META.postId ] ).toBeUndefined();
	} );

	test( 'AC-003: sending requires an active beehiiv connection', async ( { page } ) => {
		seed( { connected: false } );
		const id = createPost( { title: 'QA E2E send AC-003', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id}`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toContain( 'Connect your beehiiv account' );
	} );

	test( 'AC-004: sending requires a configured beehiiv publication', async ( { page } ) => {
		seed( { publication: '' } );
		const id = createPost( { title: 'QA E2E send AC-004', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toContain( 'Choose a publication' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: schedule newsletter delivery', () => {
	test( 'AC-005: scheduling a post for a future date schedules the newsletter', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-005', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );
		const future = isoGmt( 2 * DAY );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'future', date_gmt: future } );
		expect( res.body.status ).toBe( 'future' );
		const created = creates( getLog() );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ].body.scheduled_at ).toBe( `${ future }Z` );
		expect( getMeta( id )[ META.scheduledAt ] ).toBe( `${ future }Z` );
	} );

	test( 'AC-006: the scheduled send time is sent to beehiiv in UTC', async ( { page } ) => {
		// A non-UTC site timezone proves the local publish time is converted.
		seed( { timezone: 'America/New_York' } );
		const id = createPost( { title: 'QA E2E send AC-006', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );
		const future = isoGmt( 3 * DAY );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'future', date_gmt: future } );
		expect( res.body.date ).not.toBe( future ); // Local time really differs from UTC.
		const created = creates( getLog() );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ].body.scheduled_at ).toBe( `${ future }Z` );
		expect( created[ 0 ].body.scheduled_at ).toMatch( /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/ );
	} );

	test( 'AC-007: moving the send time later deletes the old beehiiv post and recreates it', async ( { page } ) => {
		seed();
		const oneDay = isoGmt( DAY );
		const id = createPost( {
			title: 'QA E2E send AC-007',
			status: 'future',
			dateGmt: oneDay.replace( 'T', ' ' ),
			meta: { [ META.postId ]: LINKED_ID, [ META.scheduledAt ]: `${ oneDay }Z`, [ META.send ]: '' },
		} );
		const rest = await restAs( page );
		const later = isoGmt( 3 * DAY );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { date_gmt: later } );
		const log = getLog();
		const deleted = deletes( log );
		const created = creates( log );
		expect( deleted ).toHaveLength( 1 );
		expect( deleted[ 0 ].url ).toContain( `/posts/${ LINKED_ID }` );
		expect( created ).toHaveLength( 1 );
		expect( created[ 0 ].body.scheduled_at ).toBe( `${ later }Z` );
		expect( log.indexOf( deleted[ 0 ] ) ).toBeLessThan( log.indexOf( created[ 0 ] ) );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBe( MOCK_CREATED_ID );
		expect( meta[ META.scheduledAt ] ).toBe( `${ later }Z` );
	} );

	test( 'AC-008: a send time that has already passed is rejected', async ( { page } ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E send AC-008',
			meta: { [ META.send ]: '1', [ META.sendDate ]: '2020-01-01 10:00:00' },
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toContain( 'already passed' );
	} );

	test( 'AC-009: a send time before the post publishes is rejected', async ( { page } ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E send AC-009',
			meta: { [ META.send ]: '1', [ META.sendDate ]: isoGmt( DAY ).replace( 'T', ' ' ) },
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'future', date_gmt: isoGmt( 3 * DAY ) } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toContain( "can't send before this post publishes" );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: sync post edits before send', () => {
	test( 'AC-010: editing a linked post syncs the change to beehiiv', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-010' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			title: 'QA E2E send AC-010 edited',
			content: '<!-- wp:paragraph --><p>QA E2E edited body AC-010.</p><!-- /wp:paragraph -->',
		} );
		const patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		expect( patched[ 0 ].body.title ).toBe( 'QA E2E send AC-010 edited' );
		expect( JSON.stringify( patched[ 0 ].body.blocks ) ).toContain( 'QA E2E edited body AC-010.' );
	} );

	test( 'AC-011: a sync keeps the existing beehiiv post reference', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-011' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-011 edited' } );
		const log = getLog();
		expect( updates( log ) ).toHaveLength( 1 );
		expect( updates( log )[ 0 ].url ).toContain( `/posts/${ LINKED_ID }` );
		expect( creates( log ) ).toHaveLength( 0 );
		expect( deletes( log ) ).toHaveLength( 0 );
		expect( getMeta( id )[ META.postId ] ).toBe( LINKED_ID );
	} );

	test( 'AC-012: saving a draft does not contact beehiiv', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-012', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-012 edited' } );
		expect( res.body.status ).toBe( 'draft' );
		expect( getLog() ).toHaveLength( 0 );
		expect( getMeta( id )[ META.postId ] ).toBeUndefined();
	} );

	test( 'AC-013: a REST save with an empty beehiiv post reference keeps the stored one', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-013' );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { meta: { [ META.postId ]: '' } } );
		expect( res.status ).toBe( 200 );
		expect( getMeta( id )[ META.postId ] ).toBe( LINKED_ID );

		// And a save that omits the reference entirely also keeps it.
		await rest( 'POST', `/wp/v2/posts/${ id }`, { meta: { [ META.subtitle ]: 'AC-013 sub' } } );
		expect( getMeta( id )[ META.postId ] ).toBe( LINKED_ID );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: cancel scheduled newsletters', () => {
	test( 'AC-014: unpublishing a post cancels its beehiiv newsletter', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-014' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'draft' } );
		const deleted = deletes( getLog() );
		expect( deleted ).toHaveLength( 1 );
		expect( deleted[ 0 ].url ).toContain( `/publications/${ PUBLICATION_ID }/posts/${ LINKED_ID }` );
	} );

	test( 'AC-015: trashing or permanently deleting a post cancels its beehiiv newsletter', async ( { page } ) => {
		seed();
		const trashId = createLinkedPost( 'QA E2E send AC-015 trash' );
		const rest = await restAs( page );

		await rest( 'DELETE', `/wp/v2/posts/${ trashId }` );
		let deleted = deletes( getLog() );
		expect( deleted ).toHaveLength( 1 );
		expect( deleted[ 0 ].url ).toContain( `/posts/${ LINKED_ID }` );

		const forceId = createLinkedPost( 'QA E2E send AC-015 force delete' );
		await rest( 'DELETE', `/wp/v2/posts/${ forceId }?force=true` );
		deleted = deletes( getLog() );
		expect( deleted ).toHaveLength( 1 );
		expect( deleted[ 0 ].url ).toContain( `/posts/${ LINKED_ID }` );
	} );

	test( 'AC-016: cancelling clears the beehiiv post link from WordPress', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-016', { meta: { [ META.scheduledAt ]: '2099-01-01T00:00:00Z' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'draft' } );
		expect( deletes( getLog() ) ).toHaveLength( 1 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.scheduledAt ] ).toBeUndefined();
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-005: understand newsletter errors', () => {
	test( 'AC-017: a failed send is stored on the post and shown in the block editor', async ( { page } ) => {
		seed( { postsMock: { status: 500, message: 'Server Error', body: { message: 'boom' } } } );
		const id = createPost( { title: 'QA E2E send AC-017', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const meta = getMeta( id );
		expect( meta[ META.errorType ] ).toBe( 'send' );
		expect( meta[ META.error ] ).toContain( 'temporarily unavailable' );

		await openPostEditor( page, id );
		await openBeehiivSidebar( page );
		const sidebar = page.locator( '.beehiiv-post-settings' );
		await expect( sidebar.getByText( 'Could not send this post to beehiiv:' ) ).toBeVisible( { timeout: 15000 } );
		await expect( sidebar.getByText( /temporarily unavailable/ ) ).toBeVisible();
	} );

	test( 'AC-018: error messages name the specific failure reason', async ( { page } ) => {
		const cases = [
			[ { connected: false }, /Connect your beehiiv account/ ],
			[ { publication: '' }, /Choose a publication/ ],
			[ { postsMock: { status: 403, body: { message: 'Forbidden' } } }, /connection expired/ ],
			[ { postsMock: { status: 422, body: { errors: [ { message: 'Subject too long' } ] } } }, /beehiiv rejected this newsletter: Subject too long/ ],
		];
		const rest = await restAs( page );
		const seen = new Set();
		for ( const [ seedArgs, expected ] of cases ) {
			seed( seedArgs );
			const id = createPost( { title: 'QA E2E send AC-018', meta: { [ META.send ]: '1' } } );
			await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
			const message = getMeta( id )[ META.error ];
			expect( message ).toMatch( expected );
			seen.add( message );
		}
		expect( seen.size ).toBe( cases.length );
	} );

	test( 'AC-019: a post with a send error can be retried after the issue is fixed', async ( { page } ) => {
		seed( { postsMock: { status: 500, body: { message: 'boom' } } } );
		const id = createPost( { title: 'QA E2E send AC-019', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );
		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( getMeta( id )[ META.error ] ).toBeTruthy();

		seed(); // beehiiv recovers.
		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-019 retry' } );
		expect( creates( getLog() ) ).toHaveLength( 1 );
		expect( getMeta( id )[ META.postId ] ).toBe( MOCK_CREATED_ID );
	} );

	test( 'AC-020: the error is cleared when a retry succeeds', async ( { page } ) => {
		seed( { postsMock: { status: 500, body: { message: 'boom' } } } );
		const id = createPost( { title: 'QA E2E send AC-020', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );
		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( getMeta( id )[ META.error ] ).toBeTruthy();

		seed();
		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-020 retry' } );
		const meta = getMeta( id );
		expect( meta[ META.error ] ).toBeUndefined();
		expect( meta[ META.errorType ] ).toBeUndefined();
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-006: sync every newsletter field on save', () => {
	test( 'AC-021: each sync sends search/social title and description (no SEO plugin: post title and excerpt)', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-021', { excerpt: 'QA E2E excerpt AC-021' } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-021 seo' } );
		const patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		// Field-name agnostic: some SEO/social-ish field must carry the title and the excerpt.
		const seoValues = entries( patched[ 0 ].body )
			.filter( ( [ k, v ] ) => typeof v === 'string' && /seo|meta|og_|twitter|social_(title|description)|description/i.test( k ) )
			.map( ( [ , v ] ) => v );
		expect( seoValues ).toContain( 'QA E2E send AC-021 seo' );
		expect( seoValues ).toContain( 'QA E2E excerpt AC-021' );
	} );

	test( 'AC-022: each sync makes the beehiiv tags match the WordPress tags', async ( { page } ) => {
		seed();
		const tagged = createLinkedPost( 'QA E2E send AC-022 tagged', { tags: [ 'qa-alpha', 'qa-beta' ] } );
		const untagged = createLinkedPost( 'QA E2E send AC-022 untagged' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ tagged }`, { title: 'QA E2E send AC-022 tagged edit' } );
		let patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		let tagFields = entries( patched[ 0 ].body ).filter( ( [ k, v ] ) => /tag/i.test( k ) && Array.isArray( v ) );
		expect( tagFields.length ).toBeGreaterThan( 0 );
		expect( [ ...tagFields[ 0 ][ 1 ] ].sort() ).toEqual( [ 'qa-alpha', 'qa-beta' ] );

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ untagged }`, { title: 'QA E2E send AC-022 untagged edit' } );
		patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		tagFields = entries( patched[ 0 ].body ).filter( ( [ k, v ] ) => /tag/i.test( k ) && Array.isArray( v ) );
		expect( tagFields.length ).toBeGreaterThan( 0 );
		expect( tagFields[ 0 ][ 1 ] ).toEqual( [] );
	} );

	test( 'AC-023: WordPress data with no beehiiv equivalent is ignored and never blocks a sync', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-023', {
			meta: { qa_e2e_unsupported_field: 'QA-E2E-UNSUPPORTED-VALUE' },
			extra: { comment_status: 'closed', post_password: '' },
		} );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-023 edited', sticky: true, format: 'aside' } );
		expect( res.status ).toBe( 200 );
		const patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		expect( JSON.stringify( patched[ 0 ].body ) ).not.toContain( 'QA-E2E-UNSUPPORTED-VALUE' );
		expect( getMeta( id )[ META.error ] ).toBeUndefined();
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-007: protect newsletters that already sent', () => {
	const SENT_ID = 'post_qa_e2e_sent';
	const pastUnix = Math.floor( ( Date.now() - 2 * DAY ) / 1000 );
	const sentMocks = [
		[
			'GET sent post',
			{
				needle: `/posts/${ SENT_ID }`,
				method: 'GET',
				body: { data: { id: SENT_ID, status: 'confirmed', publish_date: pastUnix, displayed_date: pastUnix } },
			},
		],
	];
	const sentFixture = ( title ) =>
		createLinkedPost( title, {
			meta: { [ META.postId ]: SENT_ID, [ META.scheduledAt ]: new Date( pastUnix * 1000 ).toISOString().replace( /\.\d{3}Z$/, 'Z' ) },
		} );

	test( 'AC-024: a newsletter beehiiv already sent is never updated; the WordPress edit still saves', async ( { page } ) => {
		seed( { mocks: sentMocks } );
		const id = sentFixture( 'QA E2E send AC-024' );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-024 edited after send' } );
		expect( res.status ).toBe( 200 );
		expect( res.body.title.raw ).toBe( 'QA E2E send AC-024 edited after send' );
		const log = getLog();
		expect( updates( log ) ).toHaveLength( 0 );
		expect( creates( log ) ).toHaveLength( 0 );
		expect( deletes( log ) ).toHaveLength( 0 );
	} );

	test( 'AC-025: when the send time has passed, the sync confirms the state with beehiiv first', async ( { page } ) => {
		seed( { mocks: sentMocks } );
		const id = sentFixture( 'QA E2E send AC-025' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-025 edited' } );
		const log = getLog();
		const lookups = log.filter( ( r ) => r.method === 'GET' && r.url.includes( `/posts/${ SENT_ID }` ) );
		expect( lookups ).toHaveLength( 1 );
		expect( updates( log ) ).toHaveLength( 0 );
	} );

	test( 'AC-026: once a post is marked as sent, later saves make no contact with beehiiv', async ( { page } ) => {
		seed( { mocks: sentMocks } );
		const id = sentFixture( 'QA E2E send AC-026' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-026 first edit' } );
		expect( updates( getLog() ) ).toHaveLength( 0 ); // First save: confirmed sent, no update.

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ id }`, { title: 'QA E2E send AC-026 second edit' } );
		expect( getLog() ).toHaveLength( 0 );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( "US-008: use the post's newsletter title and subtitle", () => {
	test( 'AC-027: subject line is the newsletter title when set, else the post title (send and sync)', async ( { page } ) => {
		seed();
		const withTitle = createPost( { title: 'QA E2E send AC-027 post', meta: { [ META.send ]: '1', [ META.title ]: 'AC-027 inbox subject' } } );
		const without = createPost( { title: 'QA E2E send AC-027 plain', meta: { [ META.send ]: '1' } } );
		const linked = createLinkedPost( 'QA E2E send AC-027 linked', { meta: { [ META.title ]: 'AC-027 linked subject' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ withTitle }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ without }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { content: CONTENT } );
		const log = getLog();
		const created = creates( log );
		expect( created ).toHaveLength( 2 );
		expect( created[ 0 ].body.email_settings.email_subject_line ).toBe( 'AC-027 inbox subject' );
		expect( created[ 1 ].body.email_settings.email_subject_line ).toBe( 'QA E2E send AC-027 plain' );
		expect( updates( log )[ 0 ].body.email_settings.email_subject_line ).toBe( 'AC-027 linked subject' );
	} );

	test( 'AC-028: headline and web title stay the WordPress post title', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-028 post', meta: { [ META.send ]: '1', [ META.title ]: 'AC-028 inbox subject' } } );
		const linked = createLinkedPost( 'QA E2E send AC-028 linked', { meta: { [ META.title ]: 'AC-028 linked subject' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { title: 'QA E2E send AC-028 linked renamed' } );
		const log = getLog();
		expect( creates( log )[ 0 ].body.title ).toBe( 'QA E2E send AC-028 post' );
		expect( updates( log )[ 0 ].body.title ).toBe( 'QA E2E send AC-028 linked renamed' );
		expect( updates( log )[ 0 ].body.email_settings.email_subject_line ).toBe( 'AC-028 linked subject' );
		// The newsletter title appears nowhere except the subject line.
		const elsewhere = entries( creates( log )[ 0 ].body ).filter( ( [ k, v ] ) => v === 'AC-028 inbox subject' && k !== 'email_subject_line' );
		expect( elsewhere ).toHaveLength( 0 );
	} );

	test( 'AC-029: the newsletter subtitle is sent as the beehiiv subtitle; none when empty', async ( { page } ) => {
		seed();
		const withSub = createPost( { title: 'QA E2E send AC-029 sub', meta: { [ META.send ]: '1', [ META.subtitle ]: 'AC-029 subtitle' } } );
		const without = createPost( { title: 'QA E2E send AC-029 nosub', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ withSub }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ without }`, { status: 'publish' } );
		const created = creates( getLog() );
		expect( created ).toHaveLength( 2 );
		expect( created[ 0 ].body.subtitle ).toBe( 'AC-029 subtitle' );
		expect( created[ 1 ].body ).not.toHaveProperty( 'subtitle' );
	} );

	test( 'AC-030: changing or clearing the newsletter title updates a linked newsletter subject on save', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-030 post', { meta: { [ META.title ]: 'AC-030 original subject' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { meta: { [ META.title ]: 'AC-030 changed subject' } } );
		expect( updates( getLog() ).pop().body.email_settings.email_subject_line ).toBe( 'AC-030 changed subject' );

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ id }`, { meta: { [ META.title ]: '' } } );
		expect( updates( getLog() ).pop().body.email_settings.email_subject_line ).toBe( 'QA E2E send AC-030 post' );
	} );

	test( 'AC-031: changing the newsletter subtitle updates a linked newsletter subtitle on save', async ( { page } ) => {
		seed();
		const id = createLinkedPost( 'QA E2E send AC-031', { meta: { [ META.subtitle ]: 'AC-031 original' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { meta: { [ META.subtitle ]: 'AC-031 changed' } } );
		const patched = updates( getLog() );
		expect( patched ).toHaveLength( 1 );
		expect( patched[ 0 ].body.subtitle ).toBe( 'AC-031 changed' );
	} );

	test( 'AC-032: email preview text is not set from either field', async ( { page } ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E send AC-032',
			meta: { [ META.send ]: '1', [ META.title ]: 'AC-032 subject', [ META.subtitle ]: 'AC-032 subtitle' },
		} );
		const linked = createLinkedPost( 'QA E2E send AC-032 linked', { meta: { [ META.title ]: 'AC-032 subject', [ META.subtitle ]: 'AC-032 subtitle' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { content: CONTENT } );
		const log = getLog();
		for ( const req of [ creates( log )[ 0 ], updates( log )[ 0 ] ] ) {
			const previewKeys = entries( req.body ).filter( ( [ k ] ) => /preview/i.test( k ) );
			expect( previewKeys ).toHaveLength( 0 );
		}
	} );
} );

// ---------------------------------------------------------------------------
test.describe( "US-009: follow the post's email title/subtitle display choice", () => {
	test( 'AC-033: the title is no longer always shown; it follows the post choice', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-033', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() )[ 0 ].body.email_settings.display_title_in_email ).toBe( false );
	} );

	test( 'AC-034: choice on shows title and subtitle; off or never set hides both', async ( { page } ) => {
		seed();
		const on = createPost( { title: 'QA E2E send AC-034 on', meta: { [ META.send ]: '1', [ META.show ]: '1' } } );
		const off = createPost( { title: 'QA E2E send AC-034 off', meta: { [ META.send ]: '1', [ META.show ]: '' } } );
		const unset = createPost( { title: 'QA E2E send AC-034 unset', meta: { [ META.send ]: '1' } } );
		const rest = await restAs( page );

		for ( const id of [ on, off, unset ] ) {
			await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		}
		const [ cOn, cOff, cUnset ] = creates( getLog() ).map( ( r ) => r.body.email_settings );
		expect( cOn ).toMatchObject( { display_title_in_email: true, display_subtitle_in_email: true } );
		expect( cOff ).toMatchObject( { display_title_in_email: false, display_subtitle_in_email: false } );
		expect( cUnset ).toMatchObject( { display_title_in_email: false, display_subtitle_in_email: false } );
	} );

	test( 'AC-035: the choice applies on first send and every sync; changing it updates a linked newsletter', async ( { page } ) => {
		seed();
		const id = createPost( { title: 'QA E2E send AC-035 first send', meta: { [ META.send ]: '1', [ META.show ]: '1' } } );
		const linked = createLinkedPost( 'QA E2E send AC-035 linked' ); // Never set -> hidden on next sync.
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() )[ 0 ].body.email_settings.display_title_in_email ).toBe( true );

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { content: CONTENT } );
		expect( updates( getLog() )[ 0 ].body.email_settings ).toMatchObject( { display_title_in_email: false, display_subtitle_in_email: false } );

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { meta: { [ META.show ]: true } } );
		expect( updates( getLog() )[ 0 ].body.email_settings ).toMatchObject( { display_title_in_email: true, display_subtitle_in_email: true } );

		clearLog();
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { meta: { [ META.show ]: false } } );
		expect( updates( getLog() )[ 0 ].body.email_settings ).toMatchObject( { display_title_in_email: false, display_subtitle_in_email: false } );
	} );

	test( 'AC-036: the byline stays hidden whatever the choice', async ( { page } ) => {
		seed();
		const on = createPost( { title: 'QA E2E send AC-036 on', meta: { [ META.send ]: '1', [ META.show ]: '1' } } );
		const off = createPost( { title: 'QA E2E send AC-036 off', meta: { [ META.send ]: '1' } } );
		const linked = createLinkedPost( 'QA E2E send AC-036 linked', { meta: { [ META.show ]: '1' } } );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ on }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ off }`, { status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ linked }`, { content: CONTENT } );
		const log = getLog();
		for ( const req of [ ...creates( log ), ...updates( log ) ] ) {
			expect( req.body.email_settings.display_byline_in_email ).toBe( false );
		}
		expect( creates( log ) ).toHaveLength( 2 );
		expect( updates( log ) ).toHaveLength( 1 );
	} );
} );
