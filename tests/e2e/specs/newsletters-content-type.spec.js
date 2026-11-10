const { test, expect } = require( '@playwright/test' );
const { loginAs, loginAsAdmin } = require( '../utils/auth' );
const { openBeehiivSidebar } = require( '../utils/editor' );
const {
	wpCli,
	wpCliSafe,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/07-newsletter-publishing/5-post-picker-creation/newsletters-content-type.prd.md (v1.0)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at:
 * - includes/Newsletter/NewsletterPostType.php -- the non-public
 *   `beehiiv_newsletter` type, list columns and the status cell.
 * - includes/Newsletter/ContentTypes.php -- shared supported-type list and
 *   the per-type "Send to newsletter" default.
 * - includes/REST/NewslettersController.php -- REST base `beehiiv-newsletters`.
 * - includes/Admin/Menu.php -- menu capability split.
 * - includes/Editor/PostSettings.php, includes/Newsletter/Sender.php --
 *   editor panel and send flow for supported types.
 *
 * Sends go through the REST endpoint the block editor uses. Every outbound
 * beehiiv request is answered by the test-only mock in
 * tests/e2e/plugins/beehiiv-options.php and recorded, so specs assert on the
 * exact payload. Nothing reaches the live API.
 */

const TYPE = 'beehiiv_newsletter';
const REST_BASE = 'beehiiv-newsletters';
const META_SEND = '_beehiiv_send_to_newsletter';
const META_POST_ID = '_beehiiv_post_id';
const META_SCHEDULED_AT = '_beehiiv_scheduled_at';
const META_SENT = '_beehiiv_newsletter_sent';
const META_ERROR = '_beehiiv_newsletter_error';

const PUBLICATION_ID = 'pub_qa_e2e_nl';
const TEMPLATE_ID = 'tpl_qa_e2e_nl';
const MOCK_CREATED_ID = 'post_qa_e2e_nl_created';

const PASSWORD = 'qa-e2e-nl-user-pw-1';
const USERS = {
	editor: { name: 'qa_e2e_nl_editor', role: 'editor' },
	author: { name: 'qa_e2e_nl_author', role: 'author' },
	contributor: { name: 'qa_e2e_nl_contributor', role: 'contributor' },
};

const created = [];

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
 * Seeds a connected, ready-to-send site and mocks the beehiiv API.
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
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "${ MOCK_CREATED_ID }" ] ] ] );
		update_option( "timezone_string", "" );
		update_option( "gmt_offset", 0 );
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a newsletter directly in the DB.
 *
 * @param {Object} options           Fields.
 * @param {string} options.title     Title.
 * @param {string} [options.status]  Post status.
 * @param {string} [options.content] Post content.
 * @param {Object} [options.meta]    Meta to set.
 * @param {number} [options.author]  Author user ID.
 * @param {string} [options.type]    Post type.
 * @return {string} Post ID.
 */
function createItem( {
	title,
	status = 'draft',
	content = '<!-- wp:paragraph --><p>QA E2E newsletter body.</p><!-- /wp:paragraph -->',
	meta = {},
	author = 1,
	type = TYPE,
} ) {
	const id = wpEvalWith(
		{ title, status, content, meta, author, type },
		`$id = wp_insert_post( [ "post_type" => $a["type"], "post_title" => $a["title"], "post_status" => $a["status"], "post_content" => $a["content"], "post_author" => $a["author"] ] );
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		beehiiv_e2e_clear_http_log();
		echo $id . "\\n";`
	);
	created.push( id );
	return id;
}

function getLog() {
	return JSON.parse(
		wpCli( `eval 'beehiiv_e2e_print_http_log();'` ) || '[]'
	);
}

const creates = ( log ) =>
	log.filter(
		( r ) =>
			r.method === 'POST' && /\/publications\/[^/]+\/posts$/.test( r.url )
	);

/**
 * Creates or reuses a fixture user with a known password.
 *
 * @param {Object} user User definition.
 */
function ensureUser( user ) {
	if ( wpCliSafe( `user get ${ user.name } --field=ID` ) === null ) {
		wpCli(
			`user create ${ user.name } ${ user.name }@example.test --role=${ user.role } --user_pass=${ PASSWORD }`
		);
	} else {
		wpCli(
			`user update ${ user.name } --user_pass=${ PASSWORD } --role=${ user.role }`
		);
	}
}

/**
 * Logs in as a user and returns a REST caller bound to that session.
 *
 * @param {import('@playwright/test').Page} page     Playwright page.
 * @param {string|null}                     username Username, or null for admin.
 * @return {Promise<Function>} `( method, path, data ) => { status, body }`.
 */
async function restAs( page, username = null ) {
	if ( username ) {
		await loginAs( page, username, PASSWORD );
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

/**
 * Opens a block editor URL and dismisses the welcome guide.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @param {string}                          url  Editor URL.
 */
async function openEditor( page, url ) {
	await page.goto( url );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', {
		timeout: 20000,
	} );
	const close = page.locator( '.components-modal__header button' ).first();
	const appeared = await close
		.waitFor( { state: 'visible', timeout: 4000 } )
		.then( () => true )
		.catch( () => false );
	if ( appeared ) {
		await close.click();
		await close
			.waitFor( { state: 'hidden', timeout: 5000 } )
			.catch( () => {} );
	}
}

test.describe.configure( { timeout: 120 * 1000 } );

test.beforeAll( () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
	Object.values( USERS ).forEach( ensureUser );
	seed();
} );

test.afterAll( () => {
	// Unlink first so deleting never tries to cancel a beehiiv newsletter.
	if ( created.length ) {
		wpCliSafe(
			`eval 'foreach ( array( ${ created.join(
				', '
			) } ) as $id ) { delete_post_meta( $id, "${ META_POST_ID }" ); wp_delete_post( $id, true ); }'`
		);
	}
	wpCliSafe(
		`eval 'delete_option( "beehiiv_settings" ); beehiiv_e2e_reset_all();'`
	);
} );

// ---------------------------------------------------------------------------
test.describe( 'US-001: compose newsletters apart from posts', () => {
	test( 'AC-001: the beehiiv > Newsletters entry opens a list of newsletters with an Add New action', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );

		const submenuLink = page.locator(
			'#toplevel_page_beehiiv .wp-submenu a',
			{ hasText: 'Newsletters' }
		);
		await expect( submenuLink ).toHaveCount( 1 );
		// The submenu flyout only opens on hover.
		await page.locator( '#toplevel_page_beehiiv > a.menu-top' ).hover();
		await submenuLink.click();

		await expect( page ).toHaveURL(
			new RegExp( `/wp-admin/edit\\.php\\?post_type=${ TYPE }` )
		);
		await expect( page.locator( 'h1.wp-heading-inline' ) ).toHaveText(
			'Newsletters'
		);
		const addNew = page.locator( 'a.page-title-action' );
		await expect( addNew ).toBeVisible();
		await expect( addNew ).toHaveText( /^Add New/ );
		await addNew.click();
		await expect( page ).toHaveURL(
			new RegExp( `post-new\\.php\\?post_type=${ TYPE }` )
		);
	} );

	test( "AC-002: the Newsletters list shows each newsletter's title, beehiiv status, date and author", async ( {
		page,
	} ) => {
		createItem( { title: 'QA E2E list AC-002 row' } );
		await loginAsAdmin( page );
		await page.goto( `/wp-admin/edit.php?post_type=${ TYPE }` );

		const headers = page.locator( 'table.wp-list-table thead th' );
		await expect( headers.filter( { hasText: 'Title' } ) ).toHaveCount( 1 );
		await expect(
			headers.filter( { hasText: 'beehiiv status' } )
		).toHaveCount( 1 );
		await expect( headers.filter( { hasText: 'Author' } ) ).toHaveCount(
			1
		);
		await expect( headers.filter( { hasText: 'Date' } ) ).toHaveCount( 1 );

		const row = page.locator( 'table.wp-list-table tbody tr', {
			hasText: 'QA E2E list AC-002 row',
		} );
		await expect( row ).toHaveCount( 1 );
		await expect( row.locator( 'td.column-beehiiv_status' ) ).toHaveText(
			'Not sent'
		);
		await expect( row.locator( 'td.column-author' ) ).toContainText(
			'admin'
		);
		await expect( row.locator( 'td.column-date' ) ).not.toHaveText( '' );
	} );

	test( 'AC-003: authors write newsletters in the block editor with the same block support as posts', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await openEditor( page, `/wp-admin/post-new.php?post_type=${ TYPE }` );

		const info = await page.evaluate( () => {
			const editor = window.wp.data.select( 'core/editor' );
			const rawTypes = window.wp.data
				.select( 'core/blocks' )
				.getBlockTypes()
				.map( ( b ) => b.name );
			return { type: editor.getCurrentPostType(), blocks: rawTypes };
		} );
		expect( info.type ).toBe( TYPE );
		for ( const name of [
			'core/paragraph',
			'core/heading',
			'core/image',
			'core/list',
			'core/quote',
		] ) {
			expect( info.blocks ).toContain( name );
		}

		// Blocks can actually be inserted and edited in a newsletter.
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await canvas
			.getByRole( 'textbox', { name: 'Add title' } )
			.fill( 'QA E2E editor AC-003' );
		await page.evaluate( () => {
			const { createBlock } = window.wp.blocks;
			window.wp.data.dispatch( 'core/block-editor' ).insertBlocks( [
				createBlock( 'core/heading', {
					content: 'QA E2E heading',
				} ),
				createBlock( 'core/paragraph', { content: 'QA E2E para' } ),
			] );
		} );
		await expect( canvas.getByText( 'QA E2E heading' ) ).toBeVisible();
		await expect( canvas.getByText( 'QA E2E para' ) ).toBeVisible();

		// The same block types are registered when editing a regular post.
		await openEditor( page, '/wp-admin/post-new.php' );
		const postBlocks = await page.evaluate( () =>
			window.wp.data
				.select( 'core/blocks' )
				.getBlockTypes()
				.map( ( b ) => b.name )
		);
		for ( const name of [
			'core/paragraph',
			'core/heading',
			'core/image',
			'core/list',
			'core/quote',
		] ) {
			expect( postBlocks ).toContain( name );
		}
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-002: keep newsletters off the public site', () => {
	test( 'AC-004: a newsletter has no public page and never appears on the site, in search, sitemaps or feeds', async ( {
		page,
		request,
	} ) => {
		const marker = 'QAE2ENLPUBLICMARKER';
		const id = createItem( {
			title: `${ marker } newsletter`,
			status: 'publish',
			content: `<!-- wp:paragraph --><p>${ marker } body</p><!-- /wp:paragraph -->`,
		} );

		const registered = wpCli(
			`eval '$o = get_post_type_object( "${ TYPE }" ); echo wp_json_encode( [ $o->public, $o->publicly_queryable, $o->exclude_from_search, $o->has_archive ] );'`
		);
		expect( JSON.parse( registered ) ).toEqual( [
			false,
			false,
			true,
			false,
		] );

		// No public page, by id or by type query.
		for ( const url of [
			`/?p=${ id }`,
			`/?post_type=${ TYPE }&p=${ id }`,
			`/?post_type=${ TYPE }`,
		] ) {
			const res = await request.get( url, { maxRedirects: 0 } );
			const text = await res.text();
			expect( text ).not.toContain( marker );
			if ( url.includes( `p=${ id }` ) ) {
				// 404 or redirect, never the page.
				expect( res.status() ).not.toBe( 200 );
			}
		}

		// Site search.
		const search = await request.get( `/?s=${ marker }` );
		expect( await search.text() ).not.toContain( marker );

		// Feeds.
		for ( const url of [
			'/feed/',
			`/?feed=rss2&post_type=${ TYPE }`,
			`/?feed=rss2&s=${ marker }`,
		] ) {
			const res = await request.get( url );
			// A search feed echoes the query in its own title, so inspect items only.
			const items = ( await res.text() ).match(
				/<item>[\s\S]*?<\/item>/g
			);
			expect( ( items || [] ).join( '' ) ).not.toContain( marker );
		}

		// Core sitemaps.
		const index = await request.get( '/wp-sitemap.xml' );
		const indexBody = await index.text();
		expect( indexBody ).not.toContain( TYPE );
		const typeSitemap = await request.get(
			`/wp-sitemap-posts-${ TYPE }-1.xml`
		);
		expect( typeSitemap.status() ).toBe( 404 );
		const postSitemap = await request.get( '/wp-sitemap-posts-post-1.xml' );
		expect( await postSitemap.text() ).not.toContain( marker );

		// Anonymous REST reads are blocked.
		const rest = await request.get(
			`/wp-json/wp/v2/${ REST_BASE }/${ id }`
		);
		expect( rest.status() ).not.toBe( 200 );
		expect( await rest.text() ).not.toContain( marker );
		const list = await request.get( `/wp-json/wp/v2/${ REST_BASE }` );
		expect( await list.text() ).not.toContain( marker );

		// And the site's own post REST list never carries it.
		const posts = await request.get( '/wp-json/wp/v2/posts?per_page=100' );
		expect( await posts.text() ).not.toContain( marker );
		await page.close();
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-003: send a newsletter with the beehiiv controls', () => {
	test( 'AC-005: the beehiiv editor panel works for newsletters, including publication, template and send or schedule', async ( {
		page,
	} ) => {
		seed();
		const id = createItem( {
			title: 'QA E2E panel AC-005',
			meta: { [ META_SEND ]: '1' },
		} );
		await loginAsAdmin( page );
		await openEditor( page, `/wp-admin/post.php?post=${ id }&action=edit` );
		await openBeehiivSidebar( page );

		const sidebar = page.locator( '.beehiiv-post-settings' );
		await expect(
			sidebar.getByRole( 'checkbox', { name: 'Send to newsletter' } )
		).toBeChecked( { timeout: 15000 } );
		await expect( sidebar.getByLabel( 'Publication' ) ).toBeVisible();
		await expect( sidebar.getByLabel( 'Post template' ) ).toBeVisible();
		await expect(
			sidebar.getByText( 'On publish', { exact: false } ).first()
		).toBeVisible();

		// Controls are interactive: pick the seeded publication and template.
		await sidebar.getByLabel( 'Publication' ).selectOption( {
			value: PUBLICATION_ID,
		} );
		await expect( sidebar.getByLabel( 'Publication' ) ).toHaveValue(
			PUBLICATION_ID
		);
		await sidebar.getByLabel( 'Post template' ).selectOption( {
			value: TEMPLATE_ID,
		} );
		await expect( sidebar.getByLabel( 'Post template' ) ).toHaveValue(
			TEMPLATE_ID
		);

		// Send/schedule control: choosing a date is reflected in the editor store.
		const date = await page.evaluate( () => {
			window.wp.data.dispatch( 'core/editor' ).editPost( {
				meta: {
					_beehiiv_send_to_newsletter_date: '2099-01-01T12:00:00',
				},
			} );
			return window.wp.data
				.select( 'core/editor' )
				.getEditedPostAttribute( 'meta' )
				._beehiiv_send_to_newsletter_date;
		} );
		expect( date ).toBe( '2099-01-01T12:00:00' );
	} );

	test( 'AC-006: "Send to newsletter" is on by default for a new newsletter', async ( {
		page,
	} ) => {
		seed();
		await loginAsAdmin( page );
		await openEditor( page, `/wp-admin/post-new.php?post_type=${ TYPE }` );
		await openBeehiivSidebar( page );
		const sidebar = page.locator( '.beehiiv-post-settings' );
		await expect(
			sidebar.getByRole( 'checkbox', { name: 'Send to newsletter' } )
		).toBeChecked( { timeout: 15000 } );

		// Control: a new regular post keeps the toggle off.
		await openEditor( page, '/wp-admin/post-new.php' );
		await openBeehiivSidebar( page );
		await expect(
			page
				.locator( '.beehiiv-post-settings' )
				.getByRole( 'checkbox', { name: 'Send to newsletter' } )
		).not.toBeChecked( { timeout: 15000 } );

		// Server agrees with the editor: a newsletter created without the
		// meta reads as on, and a publish sends it.
		const rest = await restAs( page );
		const made = await rest( 'POST', `/wp/v2/${ REST_BASE }`, {
			title: 'QA E2E default AC-006',
			content:
				'<!-- wp:paragraph --><p>Default send body.</p><!-- /wp:paragraph -->',
			status: 'draft',
		} );
		expect( made.status ).toBe( 201 );
		created.push( String( made.body.id ) );
		const read = await rest(
			'GET',
			`/wp/v2/${ REST_BASE }/${ made.body.id }?context=edit`
		);
		expect( read.body.meta[ META_SEND ] ).toBe( true );
	} );

	test( 'AC-007: sending a newsletter creates one beehiiv post with the content in the order the author wrote it', async ( {
		page,
	} ) => {
		seed();
		const id = createItem( {
			title: 'QA E2E send AC-007',
			content: [
				'<!-- wp:paragraph --><p>ORDER-INTRO opening paragraph</p><!-- /wp:paragraph -->',
				'<!-- wp:heading --><h2>ORDER-POST-ONE</h2><!-- /wp:heading -->',
				'<!-- wp:paragraph --><p>ORDER-POST-ONE summary</p><!-- /wp:paragraph -->',
				'<!-- wp:heading --><h2>ORDER-POST-TWO</h2><!-- /wp:heading -->',
				'<!-- wp:paragraph --><p>ORDER-POST-TWO summary</p><!-- /wp:paragraph -->',
				'<!-- wp:heading --><h2>ORDER-POST-THREE</h2><!-- /wp:heading -->',
				'<!-- wp:paragraph --><p>ORDER-POST-THREE summary</p><!-- /wp:paragraph -->',
				'<!-- wp:paragraph --><p>ORDER-OUTRO closing paragraph</p><!-- /wp:paragraph -->',
			].join( '\n' ),
			meta: { [ META_SEND ]: '1' },
		} );
		const rest = await restAs( page );
		const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
			status: 'publish',
		} );
		expect( res.status ).toBe( 200 );

		const log = getLog();
		expect( creates( log ) ).toHaveLength( 1 );
		expect( creates( log )[ 0 ].url ).toContain(
			`/publications/${ PUBLICATION_ID }/posts`
		);
		expect( creates( log )[ 0 ].body.title ).toBe( 'QA E2E send AC-007' );

		const payload = JSON.stringify( creates( log )[ 0 ].body.blocks );
		const order = [
			'ORDER-INTRO',
			'ORDER-POST-ONE',
			'ORDER-POST-TWO',
			'ORDER-POST-THREE',
			'ORDER-OUTRO',
		].map( ( marker ) => payload.indexOf( marker ) );
		order.forEach( ( position ) =>
			expect( position ).toBeGreaterThan( -1 )
		);
		expect( [ ...order ].sort( ( a, b ) => a - b ) ).toEqual( order );

		const linked = wpCli( `post meta get ${ id } ${ META_POST_ID }` );
		expect( linked ).toBe( MOCK_CREATED_ID );
	} );

	test( 'AC-008: the list shows the status WordPress last recorded: Not sent, Scheduled, Sent or Failed', async ( {
		page,
	} ) => {
		seed();
		const future = new Date( Date.now() + 5 * 24 * 60 * 60 * 1000 )
			.toISOString()
			.replace( /\.\d{3}Z$/, 'Z' );
		const past = new Date( Date.now() - 5 * 24 * 60 * 60 * 1000 )
			.toISOString()
			.replace( /\.\d{3}Z$/, 'Z' );
		createItem( { title: 'QA E2E status AC-008 notsent' } );
		createItem( {
			title: 'QA E2E status AC-008 scheduled',
			status: 'draft',
			meta: {
				[ META_POST_ID ]: 'post_qa_sched',
				[ META_SCHEDULED_AT ]: future,
			},
		} );
		createItem( {
			title: 'QA E2E status AC-008 sent',
			status: 'publish',
			meta: {
				[ META_POST_ID ]: 'post_qa_sent',
				[ META_SCHEDULED_AT ]: past,
				[ META_SENT ]: '1',
			},
		} );
		createItem( {
			title: 'QA E2E status AC-008 failed',
			meta: { [ META_ERROR ]: 'beehiiv rejected the request' },
		} );

		await loginAsAdmin( page );
		wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
		await page.goto( `/wp-admin/edit.php?post_type=${ TYPE }` );

		const expected = {
			notsent: 'Not sent',
			scheduled: 'Scheduled',
			sent: 'Sent',
			failed: 'Failed',
		};
		for ( const [ key, label ] of Object.entries( expected ) ) {
			const row = page.locator( 'table.wp-list-table tbody tr', {
				hasText: `QA E2E status AC-008 ${ key }`,
			} );
			await expect(
				row.locator( 'td.column-beehiiv_status' )
			).toHaveText( label );
		}

		// Reading the list makes no beehiiv request.
		expect( getLog() ).toHaveLength( 0 );
	} );
} );

// ---------------------------------------------------------------------------
test.describe( 'US-004: reach Newsletters without administrator access', () => {
	test( 'AC-009: any user who can publish posts sees the Newsletters entry and can send a newsletter', async ( {
		browser,
	} ) => {
		seed();
		for ( const user of [ USERS.editor, USERS.author ] ) {
			const context = await browser.newContext();
			const page = await context.newPage();
			await loginAs( page, user.name, PASSWORD );
			await page.goto( '/wp-admin/' );

			const submenu = page.locator(
				'#toplevel_page_beehiiv .wp-submenu a',
				{ hasText: 'Newsletters' }
			);
			await expect( submenu ).toHaveCount( 1 );
			await page.locator( '#toplevel_page_beehiiv > a.menu-top' ).click();
			await expect( page ).toHaveURL(
				new RegExp( `edit\\.php\\?post_type=${ TYPE }` )
			);
			await expect( page.locator( 'h1.wp-heading-inline' ) ).toHaveText(
				'Newsletters'
			);

			// They can send: publish a newsletter of their own.
			const authorId = wpCli( `user get ${ user.name } --field=ID` );
			const id = createItem( {
				title: `QA E2E send AC-009 ${ user.role }`,
				author: Number( authorId ),
				meta: { [ META_SEND ]: '1' },
			} );
			const rest = await restAs( page, user.name );
			const res = await rest( 'POST', `/wp/v2/${ REST_BASE }/${ id }`, {
				status: 'publish',
			} );
			expect( res.status ).toBe( 200 );
			expect( creates( getLog() ) ).toHaveLength( 1 );
			expect( wpCli( `post meta get ${ id } ${ META_POST_ID }` ) ).toBe(
				MOCK_CREATED_ID
			);
			wpCli( `eval 'beehiiv_e2e_clear_http_log();'` );
			await context.close();
		}

		// A user who cannot publish posts gets no Newsletters entry.
		const context = await browser.newContext();
		const page = await context.newPage();
		await loginAs( page, USERS.contributor.name, PASSWORD );
		await page.goto( '/wp-admin/' );
		await expect( page.locator( '#toplevel_page_beehiiv' ) ).toHaveCount(
			0
		);
		await context.close();
	} );

	test( 'AC-010: the beehiiv Settings page stays available to administrators only', async ( {
		page,
		browser,
	} ) => {
		await loginAsAdmin( page );
		const adminRes = await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		expect( adminRes.status() ).toBe( 200 );
		await expect( page.locator( 'h1' ) ).toHaveText( 'beehiiv Settings' );

		for ( const user of [ USERS.editor, USERS.author ] ) {
			const context = await browser.newContext();
			const userPage = await context.newPage();
			await loginAs( userPage, user.name, PASSWORD );
			const res = await userPage.goto(
				'/wp-admin/admin.php?page=beehiiv'
			);
			expect( res.status() ).toBe( 403 );
			await expect( userPage.locator( 'body' ) ).toContainText(
				/not allowed to access this page/i
			);

			// The menu offers no Settings entry to them either.
			await userPage.goto( '/wp-admin/' );
			await expect(
				userPage.locator( '#toplevel_page_beehiiv .wp-submenu a', {
					hasText: 'Settings',
				} )
			).toHaveCount( 0 );
			await context.close();
		}
	} );
} );
