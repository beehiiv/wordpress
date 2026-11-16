const { test, expect } = require( '@playwright/test' );
const { loginAs, loginAsAdmin } = require( '../utils/auth' );
const {
	openPostEditor,
	openBeehiivSidebar,
	saveDraft,
} = require( '../utils/editor' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/3-newsletter-template-selection/post-template-selection.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - src/js/editor/post-settings/components/newsletter-template-select.js
 * - includes/Newsletter/PostSettingsBuilder.php
 * - includes/Newsletter/Sender.php
 * - includes/REST/PostTemplatesController.php
 *
 * Every outbound beehiiv request is answered by the test-only
 * `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php and
 * recorded in its request log. Nothing reaches the live API.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	postId: '_beehiiv_post_id',
	template: '_beehiiv_post_template_id',
	error: '_beehiiv_newsletter_error',
};

const PUBLICATION_ID = 'pub_qa_e2e_ptsel';
const DEFAULT_TEMPLATE = 'tpl_qa_e2e_default';
const OTHER_TEMPLATE = 'tpl_qa_e2e_other';
const NEW_TEMPLATE = 'tpl_qa_e2e_brand_new';
const MOCK_CREATED_ID = 'post_qa_e2e_ptsel_created';
const LINKED_ID = 'post_qa_e2e_ptsel_linked';
const REQUIRED_MESSAGE =
	'Choose a post template before sending this post to beehiiv.';
const SIDEBAR = '.beehiiv-post-settings';
const CONTENT =
	'<!-- wp:paragraph --><p>QA E2E template selection body.</p><!-- /wp:paragraph -->';

const USERS = {
	editor: { name: 'qa_e2e_ptsel_editor', pass: 'qa-e2e-ptsel-editor-1!' },
	author: { name: 'qa_e2e_ptsel_author', pass: 'qa-e2e-ptsel-author-1!' },
};

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
 * Seeds a "ready to send" site with templates, plus optional settings.
 *
 * @param {Object}  [options]                 Seed options.
 * @param {boolean} [options.requireTemplate] Turn the required-template setting on.
 * @param {string}  [options.defaultTemplate] Site default template ID, or empty for none.
 * @param {Array}   [options.mocks]           Extra `[ needle, response ]` HTTP mocks, matched first.
 */
function seed( {
	requireTemplate = false,
	defaultTemplate = DEFAULT_TEMPLATE,
	mocks = [],
} = {} ) {
	wpEvalWith(
		{ requireTemplate, defaultTemplate, mocks },
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [
			"publication_id" => "${ PUBLICATION_ID }",
			"post_template_id" => $a["defaultTemplate"],
			"require_template_choice" => (bool) $a["requireTemplate"],
		] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [
			[ "id" => "${ DEFAULT_TEMPLATE }", "name" => "QA Default Template" ],
			[ "id" => "${ OTHER_TEMPLATE }", "name" => "QA Other Template" ],
		] );
		foreach ( $a["mocks"] as $m ) { beehiiv_e2e_mock_http( $m[0], $m[1] ); }
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "${ MOCK_CREATED_ID }" ] ] ] );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a draft post fixture and empties the request log.
 *
 * @param {string} title            Post title.
 * @param {Object} [options]        Options.
 * @param {Object} [options.meta]   Post meta.
 * @param {string} [options.status] Post status.
 * @param {number} [options.author] Author user ID.
 * @return {string} Post ID.
 */
function createPost( title, { meta = {}, status = 'draft', author = 1 } = {} ) {
	const id = wpEvalWith(
		{
			post: {
				post_type: 'post',
				post_title: title,
				post_content: CONTENT,
				post_status: status,
				post_author: author,
			},
			meta: { [ META.send ]: '1', ...meta },
		},
		`$id = wp_insert_post( $a["post"] );
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	return id;
}

function getLog() {
	return JSON.parse(
		wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
}

/**
 * All meta for a post, single values.
 *
 * @param {number|string} id Post ID.
 * @return {Object} Meta keyed by meta key.
 */
function getMeta( id ) {
	const raw = wpCli(
		`eval '$m = get_post_meta( ${ id } ); $o = []; foreach ( $m as $k => $v ) { $o[ $k ] = $v[0]; } echo wp_json_encode( (object) $o ) . "\\n";'`
	);
	return JSON.parse( raw );
}

const creates = ( log ) =>
	log.filter(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);
const postsRequests = ( log ) =>
	log.filter( ( r ) => /\/publications\/[^/]+\/posts/.test( r.url ) );

/**
 * Finds the template ID in a logged create request, wherever it is nested.
 *
 * @param {Object} request Logged request.
 * @return {string|undefined} Template ID sent to beehiiv.
 */
function sentTemplate( request ) {
	let body = request.body;
	if ( typeof body === 'string' ) {
		try {
			body = JSON.parse( body );
		} catch {
			return undefined;
		}
	}
	return body?.post_template_id;
}

/**
 * Logs in as a user and returns a REST caller bound to that session.
 *
 * @param {import('@playwright/test').Page} page   Playwright page.
 * @param {Object}                          [user] `{ name, pass }`, defaults to admin.
 * @return {Promise<Function>} `( method, path, data ) => { status, body }`.
 */
async function restAs( page, user ) {
	if ( user ) {
		await loginAs( page, user.name, user.pass );
	} else {
		await loginAsAdmin( page );
	}
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

function ensureUser( { name, pass }, role ) {
	let id = wpCliSafe( `user get ${ name } --field=ID` );
	if ( ! id ) {
		id = wpCli(
			`user create ${ name } ${ name }@example.test --role=${ role } --user_pass="${ pass }" --porcelain`
		);
	} else {
		wpCli( `user update ${ id } --user_pass="${ pass }" --role=${ role }` );
	}
	return id;
}

async function openSidebarFor( page, postId ) {
	await openPostEditor( page, postId );
	await openBeehiivSidebar( page );
	const sidebar = page.locator( SIDEBAR );
	await expect( sidebar.getByLabel( 'Post template' ) ).toBeVisible( {
		timeout: 20000,
	} );
	return sidebar;
}

test.describe.configure( { timeout: 150 * 1000 } );

let editorId;
let authorId;

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
	editorId = ensureUser( USERS.editor, 'editor' );
	authorId = ensureUser( USERS.author, 'author' );
} );

test.afterAll( async () => {
	wpCliSafe(
		`eval 'foreach ( array( ${ createdPosts.join(
			', '
		) } ) as $id ) { delete_post_meta( $id, "${
			META.postId
		}" ); wp_delete_post( $id, true ); }
		delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
	wpCliSafe( `user delete ${ editorId } --yes` );
	wpCliSafe( `user delete ${ authorId } --yes` );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: select a custom template per post', () => {
	test( 'AC-001: a post template dropdown appears in the editor post settings', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-001' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toBeVisible();
		await expect( select ).toBeEnabled();
	} );

	test( 'AC-002: the dropdown lists every beehiiv template for the configured publication', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-002' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const options = sidebar
			.getByLabel( 'Post template' )
			.locator( 'option' );
		await expect( options ).toHaveCount( 2 );
		await expect( options.nth( 0 ) ).toHaveText(
			'QA Default Template (default)'
		);
		await expect( options.nth( 1 ) ).toHaveText( 'QA Other Template' );
	} );

	test( 'AC-003: an editor can pick a template and the selection is saved to the post', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-003' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar
			.getByLabel( 'Post template' )
			.selectOption( OTHER_TEMPLATE );
		await saveDraft( page );

		expect( getMeta( id )[ META.template ] ).toBe( OTHER_TEMPLATE );

		// The saved choice survives a reload of the editor.
		const reloaded = await openSidebarFor( page, id );
		await expect( reloaded.getByLabel( 'Post template' ) ).toHaveValue(
			OTHER_TEMPLATE
		);
	} );

	test( 'AC-004: the selected template is included in the payload sent to beehiiv', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-004', {
			meta: { [ META.template ]: OTHER_TEMPLATE },
		} );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );

		const sent = creates( getLog() );
		expect( sent ).toHaveLength( 1 );
		expect( sentTemplate( sent[ 0 ] ) ).toBe( OTHER_TEMPLATE );
		expect( getMeta( id )[ META.postId ] ).toBe( MOCK_CREATED_ID );
	} );

	test( 'AC-010: the dropdown shows which template is used when no selection is made', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-010' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		// No template chosen on the post: the picker points at the site default.
		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toHaveValue( DEFAULT_TEMPLATE );
		await expect( select.locator( 'option:checked' ) ).toHaveText(
			'QA Default Template (default)'
		);
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: refresh the template list', () => {
	test( 'AC-005: a Refresh templates button appears next to the dropdown', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E ptsel AC-005' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar.getByRole( 'button', { name: 'Refresh templates' } )
		).toBeVisible();
	} );

	test( 'AC-006: clicking Refresh fetches the latest templates from beehiiv, bypassing the cache', async ( {
		page,
	} ) => {
		seed( {
			mocks: [
				[
					'/post_templates',
					{
						body: {
							data: [
								{
									id: DEFAULT_TEMPLATE,
									name: 'QA Default Template',
								},
								{
									id: OTHER_TEMPLATE,
									name: 'QA Other Template',
								},
								{
									id: NEW_TEMPLATE,
									name: 'QA Brand New Template',
								},
							],
						},
					},
				],
			],
		} );
		const id = createPost( 'QA E2E ptsel AC-006' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );
		const select = sidebar.getByLabel( 'Post template' );

		// The cached list does not know the new template, and no beehiiv call was needed.
		await expect( select.locator( 'option' ) ).toHaveCount( 2 );
		expect(
			getLog().filter( ( r ) => r.url.includes( '/post_templates' ) )
		).toHaveLength( 0 );

		const refreshRequest = page.waitForRequest(
			( req ) =>
				req.url().includes( 'post-templates' ) &&
				req.url().includes( 'refresh=1' )
		);
		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();
		await refreshRequest;

		await expect( select.locator( 'option' ) ).toHaveCount( 3 );
		await expect(
			select.locator( `option[value="${ NEW_TEMPLATE }"]` )
		).toHaveText( 'QA Brand New Template' );
		expect(
			getLog().filter( ( r ) => r.url.includes( '/post_templates' ) )
				.length
		).toBeGreaterThan( 0 );
	} );

	test( 'AC-007: a success message appears briefly after templates are refreshed', async ( {
		page,
	} ) => {
		seed( {
			mocks: [
				[
					'/post_templates',
					{
						body: {
							data: [
								{
									id: DEFAULT_TEMPLATE,
									name: 'QA Default Template',
								},
							],
						},
					},
				],
			],
		} );
		const id = createPost( 'QA E2E ptsel AC-007' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();
		const notice = sidebar.getByText( 'Templates updated from beehiiv.' );
		await expect( notice ).toBeVisible();
		// "Briefly": it goes away on its own.
		await expect( notice ).toBeHidden( { timeout: 10000 } );
	} );

	test( 'AC-008: a loading state is shown while templates are being fetched', async ( {
		page,
	} ) => {
		seed( {
			mocks: [
				[
					'/post_templates',
					{
						delay_ms: 3000,
						body: {
							data: [
								{
									id: DEFAULT_TEMPLATE,
									name: 'QA Default Template',
								},
								{
									id: OTHER_TEMPLATE,
									name: 'QA Other Template',
								},
							],
						},
					},
				],
			],
		} );
		const id = createPost( 'QA E2E ptsel AC-008' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();
		const busy = sidebar.getByRole( 'button', { name: 'Refreshing…' } );
		await expect( busy ).toBeVisible();
		await expect( busy ).toBeDisabled();
		await expect( sidebar.getByLabel( 'Post template' ) ).toBeDisabled();

		// Once the fetch finishes the normal controls return.
		await expect(
			sidebar.getByRole( 'button', { name: 'Refresh templates' } )
		).toBeEnabled( { timeout: 15000 } );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: site default template', () => {
	test( 'AC-009: with no custom template and the required setting off, the site default is used for sending', async ( {
		page,
	} ) => {
		seed( { requireTemplate: false } );
		const id = createPost( 'QA E2E ptsel AC-009 off' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		const sent = creates( getLog() );
		expect( sent ).toHaveLength( 1 );
		expect( sentTemplate( sent[ 0 ] ) ).toBe( DEFAULT_TEMPLATE );
	} );

	test( 'AC-009: with the required setting on, a post already sent to beehiiv is not blocked', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E ptsel AC-009 sent', {
			status: 'publish',
			meta: { [ META.postId ]: LINKED_ID, [ META.send ]: '' },
		} );
		const rest = await restAs( page );

		const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
			title: 'QA E2E ptsel AC-009 sent (edited)',
		} );
		expect( res.status ).toBe( 200 );

		const meta = getMeta( id );
		expect( meta[ META.error ] ).toBeUndefined();
		const log = getLog();
		expect( log.some( ( r ) => r.method === 'PATCH' ) ).toBe( true );
		// If the update payload carries a template, it is the site default.
		for ( const r of log.filter( ( x ) => x.method === 'PATCH' ) ) {
			const t = sentTemplate( r );
			if ( t !== undefined ) {
				expect( t ).toBe( DEFAULT_TEMPLATE );
			}
		}
	} );

	test( 'AC-011: a post fails to send with a clear error when no template is available', async ( {
		page,
	} ) => {
		seed( { requireTemplate: false, defaultTemplate: '' } );
		const id = createPost( 'QA E2E ptsel AC-011' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( id );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toContain(
			'Choose a default post template'
		);
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: require an editor-chosen template', () => {
	test( 'AC-012: with the setting on and a never-sent post, no template is chosen automatically and the default is not a fallback', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E ptsel AC-012' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );

		const meta = getMeta( id );
		// Nothing was stored for the post, and nothing carrying the default went out.
		expect( meta[ META.template ] ).toBeUndefined();
		expect( postsRequests( getLog() ) ).toHaveLength( 0 );
		expect( meta[ META.postId ] ).toBeUndefined();
	} );

	test( 'AC-013: sending is blocked until an editor chooses a template, even with a default configured', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E ptsel AC-013' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		expect( getMeta( id )[ META.postId ] ).toBeUndefined();
	} );

	test( 'AC-014: a blocked send shows the required message and makes no beehiiv request', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E ptsel AC-014' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );

		expect( getMeta( id )[ META.error ] ).toContain( REQUIRED_MESSAGE );
		// No request of any kind went to beehiiv's posts endpoints.
		expect( postsRequests( getLog() ) ).toHaveLength( 0 );
	} );

	for ( const role of [ 'administrator', 'editor', 'author' ] ) {
		test( `AC-015: the rule applies to the ${ role } role`, async ( {
			page,
		} ) => {
			seed( { requireTemplate: true } );
			const user = role === 'administrator' ? null : USERS[ role ];
			const userId = {
				administrator: 1,
				editor: editorId,
				author: authorId,
			}[ role ];
			const id = createPost( `QA E2E ptsel AC-015 ${ role }`, {
				author: userId,
			} );
			const rest = await restAs( page, user );

			const res = await rest( 'POST', `/wp/v2/posts/${ id }`, {
				status: 'publish',
			} );
			expect( res.status ).toBe( 200 );
			expect( creates( getLog() ) ).toHaveLength( 0 );
			expect( getMeta( id )[ META.error ] ).toContain( REQUIRED_MESSAGE );
		} );
	}

	test( 'AC-016: posts already sent to beehiiv keep their template and are not blocked', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E ptsel AC-016', {
			status: 'publish',
			meta: {
				// Template first: once linked and sent, the template meta is locked.
				[ META.template ]: OTHER_TEMPLATE,
				[ META.postId ]: LINKED_ID,
				[ META.send ]: '',
			},
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, {
			title: 'QA E2E ptsel AC-016 (edited)',
		} );

		const meta = getMeta( id );
		expect( meta[ META.error ] ).toBeUndefined();
		expect( meta[ META.template ] ).toBe( OTHER_TEMPLATE );
		expect( getLog().some( ( r ) => r.method === 'PATCH' ) ).toBe( true );
	} );

	test( 'AC-017: once an editor chooses a template the send continues, and an unknown template is still rejected', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const chosen = createPost( 'QA E2E ptsel AC-017 chosen', {
			meta: { [ META.template ]: OTHER_TEMPLATE },
		} );
		const unknown = createPost( 'QA E2E ptsel AC-017 unknown', {
			meta: { [ META.template ]: 'tpl_not_in_beehiiv' },
		} );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ chosen }`, {
			status: 'publish',
		} );
		const sent = creates( getLog() );
		expect( sent ).toHaveLength( 1 );
		expect( sentTemplate( sent[ 0 ] ) ).toBe( OTHER_TEMPLATE );
		expect( getMeta( chosen )[ META.postId ] ).toBe( MOCK_CREATED_ID );

		// Existing send-time validation still applies to the chosen template.
		wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
		await rest( 'POST', `/wp/v2/posts/${ unknown }`, {
			status: 'publish',
		} );
		expect( creates( getLog() ) ).toHaveLength( 0 );
		const meta = getMeta( unknown );
		expect( meta[ META.postId ] ).toBeUndefined();
		expect( meta[ META.error ] ).toBeTruthy();
	} );

	test( 'AC-018: with the setting off, sending behaves as before (default used, no block)', async ( {
		page,
	} ) => {
		seed( { requireTemplate: false } );
		const id = createPost( 'QA E2E ptsel AC-018' );
		const rest = await restAs( page );

		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish' } );

		const sent = creates( getLog() );
		expect( sent ).toHaveLength( 1 );
		expect( sentTemplate( sent[ 0 ] ) ).toBe( DEFAULT_TEMPLATE );
		const meta = getMeta( id );
		expect( meta[ META.error ] ).toBeUndefined();
		expect( meta[ META.postId ] ).toBe( MOCK_CREATED_ID );
	} );
} );
