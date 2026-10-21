const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { openPostEditor, openBeehiivSidebar } = require( '../utils/editor' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/06-editor-integration/2-editor-sidebar/newsletter-template-selection.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - src/js/editor/post-settings/components/newsletter-template-select.js
 * - src/js/editor/post-settings/components/newsletter-status-notices.js
 * - src/js/editor/post-settings/hooks/use-post-publication.js
 * - src/js/editor/post-settings/index.js
 * - includes/Editor/PostSettings.php
 *
 * Every outbound beehiiv request is answered by the test-only
 * `pre_http_request` mock in tests/e2e/plugins/beehiiv-options.php.
 * Nothing reaches the live API.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	postId: '_beehiiv_post_id',
	template: '_beehiiv_post_template_id',
	snippet: '_beehiiv_send_to_newsletter_snippet',
};

const PUBLICATION_ID = 'pub_qa_e2e_nts';
const DEFAULT_TEMPLATE = 'tpl_qa_e2e_nts_default';
const OTHER_TEMPLATE = 'tpl_qa_e2e_nts_other';
const NEW_TEMPLATE = 'tpl_qa_e2e_nts_brand_new';
const GONE_TEMPLATE = 'tpl_qa_e2e_nts_deleted';
const LINKED_ID = 'post_qa_e2e_nts_linked';
const REQUIRED_MESSAGE =
	'Choose a post template before sending this post to beehiiv.';
const SIDEBAR = '.beehiiv-post-settings';
const CONTENT =
	'<!-- wp:paragraph --><p>QA E2E newsletter template selection body.</p><!-- /wp:paragraph -->';

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
 * @param {Array}   [options.mocks]           Extra `[ needle, response ]` HTTP mocks.
 */
function seed( { requireTemplate = false, mocks = [] } = {} ) {
	wpEvalWith(
		{ requireTemplate, mocks },
		`beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [
			"publication_id" => "${ PUBLICATION_ID }",
			"post_template_id" => "${ DEFAULT_TEMPLATE }",
			"require_template_choice" => (bool) $a["requireTemplate"],
		] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [
			[ "id" => "${ DEFAULT_TEMPLATE }", "name" => "QA Default Template" ],
			[ "id" => "${ OTHER_TEMPLATE }", "name" => "QA Other Template" ],
		] );
		foreach ( $a["mocks"] as $m ) { beehiiv_e2e_mock_http( $m[0], $m[1] ); }
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "post_qa_e2e_nts_created" ] ] ] );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a post fixture with "Send to newsletter" on.
 *
 * @param {string} title            Post title.
 * @param {Object} [options]        Options.
 * @param {Object} [options.meta]   Post meta.
 * @param {string} [options.status] Post status.
 * @return {string} Post ID.
 */
function createPost( title, { meta = {}, status = 'draft' } = {} ) {
	const id = wpEvalWith(
		{
			post: {
				post_type: 'post',
				post_title: title,
				post_content: CONTENT,
				post_status: status,
				post_author: 1,
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

/**
 * Opens the editor sidebar for a post and waits for the template picker.
 *
 * @param {import('@playwright/test').Page} page   Playwright page.
 * @param {string}                          postId Post ID.
 * @return {Promise<import('@playwright/test').Locator>} Sidebar locator.
 */
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

test.beforeAll( async () => {
	ensurePluginActive();
} );

test.afterAll( async () => {
	if ( createdPosts.length ) {
		wpCliSafe(
			`eval 'foreach ( array( ${ createdPosts.join(
				', '
			) } ) as $id ) { wp_delete_post( $id, true ); }'`
		);
	}
	wpCliSafe(
		`eval 'delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: select a custom template for a post', () => {
	test( 'AC-001: the Post template select appears when newsletter delivery is on and templates exist', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-001' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toBeVisible();
		await expect( select ).toBeEnabled();
	} );

	test( 'AC-002: with the setting off, the site default is preselected and labeled "(default)"', async ( {
		page,
	} ) => {
		seed( { requireTemplate: false } );
		const id = createPost( 'QA E2E nts AC-002 off' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toHaveValue( DEFAULT_TEMPLATE );
		await expect( select.locator( 'option:checked' ) ).toHaveText(
			'QA Default Template (default)'
		);
	} );

	test( 'AC-002: with the setting on but the post already sent to beehiiv, the site default is preselected and labeled "(default)"', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-002 sent', {
			status: 'publish',
			meta: { [ META.postId ]: LINKED_ID },
		} );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toHaveValue( DEFAULT_TEMPLATE );
		await expect( select.locator( 'option:checked' ) ).toHaveText(
			'QA Default Template (default)'
		);
	} );

	test( 'AC-003: help text below the dropdown explains which template is used when Default is selected', async ( {
		page,
	} ) => {
		seed( { requireTemplate: false } );
		const id = createPost( 'QA E2E nts AC-003' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const help = sidebar
			.locator( '.beehiiv-newsletter-template' )
			.locator( '.components-base-control__help' );
		await expect( help ).toBeVisible( { timeout: 3000 } );
		await expect( help ).toContainText( /default/i );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: view templates from the beehiiv account', () => {
	test( 'AC-004: templates are fetched from the REST API when the picker mounts', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-004' );
		await loginAsAdmin( page );

		const request = page.waitForRequest(
			( req ) =>
				decodeURIComponent( req.url() ).includes(
					'beehiiv/v1/post-templates'
				) &&
				req.url().includes( `publication_id=${ PUBLICATION_ID }` ) &&
				! req.url().includes( 'refresh=1' ),
			{ timeout: 30000 }
		);
		await openPostEditor( page, id );
		await openBeehiivSidebar( page );
		await request;

		const sidebar = page.locator( SIDEBAR );
		const options = sidebar
			.getByLabel( 'Post template' )
			.locator( 'option' );
		await expect( options ).toHaveCount( 2 );
	} );

	test( 'AC-005: the dropdown is disabled while templates are loading', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-005' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		// Slow the next fetch so the loading window is observable.
		await page.route( /post-templates/, async ( route ) => {
			await new Promise( ( resolve ) => setTimeout( resolve, 3000 ) );
			await route.continue();
		} );
		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();

		await expect( sidebar.getByLabel( 'Post template' ) ).toBeDisabled();
		await expect( sidebar.getByLabel( 'Post template' ) ).toBeEnabled( {
			timeout: 15000,
		} );
	} );

	test( 'AC-006: a loading spinner appears while templates are being fetched', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-006' );
		await loginAsAdmin( page );

		await page.route( /post-templates/, async ( route ) => {
			await new Promise( ( resolve ) => setTimeout( resolve, 4000 ) );
			await route.continue();
		} );
		await openPostEditor( page, id );
		await openBeehiivSidebar( page );

		const sidebar = page.locator( SIDEBAR );
		await expect(
			sidebar.locator(
				'.beehiiv-newsletter-template .components-spinner'
			)
		).toBeVisible( { timeout: 10000 } );
		await expect( sidebar.getByLabel( 'Post template' ) ).toBeVisible( {
			timeout: 20000,
		} );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: refresh templates without reloading', () => {
	test( 'AC-007: Refresh templates reloads the list from beehiiv', async ( {
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
		const id = createPost( 'QA E2E nts AC-007' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );
		const select = sidebar.getByLabel( 'Post template' );
		await expect( select.locator( 'option' ) ).toHaveCount( 2 );

		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();

		await expect( select.locator( 'option' ) ).toHaveCount( 3 );
		await expect(
			select.locator( `option[value="${ NEW_TEMPLATE }"]` )
		).toHaveText( 'QA Brand New Template' );
	} );

	test( 'AC-008: "Templates updated from beehiiv." appears after refresh and disappears after about 4 seconds', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-008' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar
			.getByRole( 'button', { name: 'Refresh templates' } )
			.click();
		const notice = sidebar.getByText( 'Templates updated from beehiiv.' );
		await expect( notice ).toBeVisible();
		const shownAt = Date.now();
		await expect( notice ).toBeHidden( { timeout: 8000 } );
		const visibleMs = Date.now() - shownAt;
		expect( visibleMs ).toBeGreaterThan( 2500 );
		expect( visibleMs ).toBeLessThan( 6500 );
	} );

	test( 'AC-009: explanatory text below the refresh button notes that templates are cached', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-009' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar.locator( '.beehiiv-newsletter-template__refresh-help' )
		).toContainText( 'Templates are cached.' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004 / US-005: snippet mode', () => {
	test( 'AC-010: the Snippet newsletter toggle appears below the template selector', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-010' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const toggle = sidebar.getByLabel( 'Snippet newsletter' );
		await expect( toggle ).toBeVisible();
		const selectBox = await sidebar
			.getByLabel( 'Post template' )
			.boundingBox();
		const toggleBox = await toggle.boundingBox();
		expect( toggleBox.y ).toBeGreaterThan( selectBox.y );
	} );

	test( 'AC-011: enabling snippet mode reveals help text about inserting a More block', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-011' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const moreHelp = sidebar.getByText(
			'Insert the "More" block in your post to mark where the snippet ends.'
		);
		await expect( moreHelp ).toHaveCount( 0 );

		await sidebar.getByLabel( 'Snippet newsletter' ).check();
		await expect( moreHelp ).toBeVisible();
	} );

	test( 'AC-012: the help text explains the More block marks the snippet boundary', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-012', {
			meta: { [ META.snippet ]: '1' },
		} );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const help = sidebar.locator( '.beehiiv-post-settings-snippet' );
		await expect( help ).toContainText( '"More" block' );
		await expect( help ).toContainText( 'where the snippet ends' );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-006: verify template assignment', () => {
	test( 'AC-013: a saved template no longer available in beehiiv is still listed and labeled as unavailable', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( 'QA E2E nts AC-013', {
			meta: { [ META.template ]: GONE_TEMPLATE },
		} );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toHaveValue( GONE_TEMPLATE );
		const option = select.locator( `option[value="${ GONE_TEMPLATE }"]` );
		await expect( option ).toHaveCount( 1 );
		// The PRD says the option is labeled as unavailable, not just shown as a bare ID.
		await expect( option ).toHaveText( /unavailable/i );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-007: required template prompt', () => {
	test( 'AC-014: with the setting on and a never-sent post, the field starts empty with "Choose a template"', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-014' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).toHaveValue( '' );
		await expect( select.locator( 'option:checked' ) ).toHaveText(
			'Choose a template'
		);
	} );

	test( 'AC-015: no template is pre-selected and the "Default (from beehiiv settings)" option is not offered', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-015' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		const select = sidebar.getByLabel( 'Post template' );
		await expect( select ).not.toHaveValue( DEFAULT_TEMPLATE );
		await expect(
			select.locator( 'option', {
				hasText: 'Default (from beehiiv settings)',
			} )
		).toHaveCount( 0 );
		await expect(
			select.locator( 'option', { hasText: '(default)' } )
		).toHaveCount( 0 );
		// Real templates stay selectable.
		await expect(
			select.locator( `option[value="${ DEFAULT_TEMPLATE }"]` )
		).toHaveText( 'QA Default Template' );
	} );

	test( 'AC-016: help text under the empty field asks the editor to choose a post template', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-016' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar
				.locator( '.beehiiv-newsletter-template' )
				.locator( '.components-base-control__help' )
		).toHaveText( REQUIRED_MESSAGE );
	} );

	test( 'AC-017: a send blocked for a missing template shows an editor error notice with the same message', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-017' );

		// Publish through the real save path; the send is blocked server-side.
		await loginAsAdmin( page );
		const nonceRes = await page.request.get(
			'/wp-admin/admin-ajax.php?action=rest-nonce'
		);
		const nonce = ( await nonceRes.text() ).trim();
		const res = await page.request.fetch( `/wp-json/wp/v2/posts/${ id }`, {
			method: 'POST',
			headers: { 'X-WP-Nonce': nonce },
			data: { status: 'publish' },
		} );
		expect( res.status() ).toBe( 200 );

		const sidebar = await openSidebarFor( page, id );
		const errorNotice = sidebar
			.locator( '.components-notice.is-error' )
			.filter( { hasText: REQUIRED_MESSAGE } );
		await expect( errorNotice ).toBeVisible();
	} );

	test( 'AC-018: the prompt and help text clear once the editor chooses a template', async ( {
		page,
	} ) => {
		seed( { requireTemplate: true } );
		const id = createPost( 'QA E2E nts AC-018' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar.getByText( REQUIRED_MESSAGE ).first()
		).toBeVisible();

		const select = sidebar.getByLabel( 'Post template' );
		await select.selectOption( OTHER_TEMPLATE );

		await expect( select ).toHaveValue( OTHER_TEMPLATE );
		await expect( sidebar.getByText( REQUIRED_MESSAGE ) ).toHaveCount( 0 );
		await expect(
			select.locator( 'option', { hasText: 'Choose a template' } )
		).toHaveCount( 0 );
	} );

	test( 'AC-019: with the setting off, or the post already sent, there is no prompt, help text or notice', async ( {
		page,
	} ) => {
		// Setting off, never sent.
		seed( { requireTemplate: false } );
		const offId = createPost( 'QA E2E nts AC-019 off' );
		await loginAsAdmin( page );
		let sidebar = await openSidebarFor( page, offId );
		await expect( sidebar.getByText( REQUIRED_MESSAGE ) ).toHaveCount( 0 );
		await expect(
			sidebar
				.getByLabel( 'Post template' )
				.locator( 'option', { hasText: 'Choose a template' } )
		).toHaveCount( 0 );
		await expect( sidebar.getByLabel( 'Post template' ) ).toHaveValue(
			DEFAULT_TEMPLATE
		);

		// Setting on, already sent.
		seed( { requireTemplate: true } );
		const sentId = createPost( 'QA E2E nts AC-019 sent', {
			status: 'publish',
			meta: { [ META.postId ]: LINKED_ID },
		} );
		sidebar = await openSidebarFor( page, sentId );
		await expect( sidebar.getByText( REQUIRED_MESSAGE ) ).toHaveCount( 0 );
		await expect(
			sidebar
				.getByLabel( 'Post template' )
				.locator( 'option', { hasText: 'Choose a template' } )
		).toHaveCount( 0 );
		await expect( sidebar.getByLabel( 'Post template' ) ).toHaveValue(
			DEFAULT_TEMPLATE
		);
	} );
} );
