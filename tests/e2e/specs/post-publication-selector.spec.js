const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { openPostEditor } = require( '../utils/editor' );
const {
	wpCli,
	ensurePluginActive,
	ensurePrettyPermalinks,
} = require( '../utils/wp-cli' );

/**
 * PRD: requirements/06-editor-integration/8-post-level-newsletter-overrides/post-publication-selector.prd.md
 * (PRD-06.8.02 Post-Level Publication Selector)
 *
 * Authored by qa-e2e-author from the PRD's Acceptance Criteria and the real
 * code at the files listed in PLAN/EXECUTION (Create/Modify lists only).
 *
 * Seams (all test-only, tests/e2e/plugins/beehiiv-options.php, wp-env tests
 * environment only):
 * - beehiiv_e2e_seed_connection() + beehiiv_e2e_mock_permissions() make the
 *   site genuinely "connected with Send API" for Manager / Workspace.
 * - beehiiv_e2e_seed_publications() / beehiiv_e2e_seed_post_templates() seed
 *   the real transient caches the editor config and template REST route read.
 * - beehiiv_e2e_mock_http( '/publications/{id}/posts', ... ) answers the
 *   beehiiv create/update/delete post calls per publication, and
 *   beehiiv_e2e_start_http_log() records every outbound request (method +
 *   URL) so the spec can assert *which publication* each server-side action
 *   (create, move, update, cancel) actually targeted.
 *
 * Every editor interaction (publication/template pickers, send toggle, save,
 * publish, unpublish) goes through the real block editor and its real REST
 * save path; wp-cli is used only to arrange starting state and read results.
 */

const PUB_A = { id: 'pub_qa_alpha', name: 'Alpha Daily' };
const PUB_B = { id: 'pub_qa_beta', name: 'Beta Weekly' };
const PUB_GONE = 'pub_qa_removed';
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
const CREATED_ID = {
	[ PUB_A.id ]: 'bh_alpha_new',
	[ PUB_B.id ]: 'bh_beta_new',
};

const PUB_SELECT = '.beehiiv-newsletter-publication select';
const TPL_SELECT = '.beehiiv-newsletter-template select';
const CONTENT =
	'<!-- wp:paragraph --><p>QA newsletter body.</p><!-- /wp:paragraph -->';

const createdPostIds = [];

/**
 * Runs arbitrary PHP inside the tests-cli container (base64 avoids shell quoting issues).
 *
 * @param {string} code PHP to run, without the opening tag.
 * @return {string} The command's output.
 */
function php( code ) {
	const b64 = Buffer.from( code ).toString( 'base64' );
	return wpCli( `eval 'eval( base64_decode( "${ b64 }" ) );'` );
}

function phpJson( value ) {
	return `json_decode( base64_decode( "${ Buffer.from(
		JSON.stringify( value )
	).toString( 'base64' ) }" ), true )`;
}

/**
 * Seeds connection, permissions, publications, templates, post-API mocks and settings in one call.
 *
 * @param {Object}                            [options]
 * @param {Array<{id: string, name: string}>} [options.publications] Connected publications to seed.
 * @param {Object}                            [options.settings]     beehiiv_settings option value.
 */
function seedWorld( {
	publications = [ PUB_A, PUB_B ],
	settings = { publication_id: PUB_A.id, post_template_id: 'tpl_a1' },
} = {} ) {
	let code = `
		beehiiv_e2e_reset_all();
		beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		beehiiv_e2e_seed_publications( ${ phpJson( publications ) } );
		update_option( "beehiiv_settings", ${ phpJson( settings ) } );
	`;
	for ( const [ pubId, templates ] of Object.entries( TEMPLATES ) ) {
		code += `beehiiv_e2e_seed_post_templates( "${ pubId }", ${ phpJson(
			templates
		) } );`;
		code += `beehiiv_e2e_mock_http( "/publications/${ pubId }/posts", [ "body" => [ "data" => [ "id" => "${ CREATED_ID[ pubId ] }" ] ] ] );`;
	}
	code += 'beehiiv_e2e_start_http_log();';
	php( code );
}

function setSettings( settings ) {
	php( `update_option( "beehiiv_settings", ${ phpJson( settings ) } );` );
}

/**
 * Creates a post (status/meta arranged server-side) and returns its ID.
 *
 * @param {Object}            options
 * @param {string}            options.title    Post title.
 * @param {string}            [options.status] Post status.
 * @param {Object<string, *>} [options.meta]   Post meta to set after insert.
 * @param {string|null}       [options.date]   Post date (also used as the GMT date).
 * @return {number} The new post's ID.
 */
function createPost( { title, status = 'draft', meta = {}, date = null } ) {
	const postArr = {
		post_type: 'post',
		post_title: title,
		post_content: CONTENT,
		post_status: status,
		...( date ? { post_date: date, post_date_gmt: date } : {} ),
	};
	const out = php( `
		$id = wp_insert_post( wp_slash( ${ phpJson( postArr ) } ) );
		foreach ( ${ phpJson(
			meta
		) } as $k => $v ) { update_post_meta( $id, $k, $v ); }
		beehiiv_e2e_start_http_log();
		echo "ID=" . $id;
	` );
	const id = Number( /ID=(\d+)/.exec( out )[ 1 ] );
	createdPostIds.push( id );
	return id;
}

function readMeta( postId ) {
	const keys = [
		'_beehiiv_publication_id',
		'_beehiiv_post_template_id',
		'_beehiiv_post_id',
		'_beehiiv_linked_publication_id',
		'_beehiiv_linked_post_template_id',
		'_beehiiv_newsletter_error',
		'_beehiiv_newsletter_error_type',
		'_beehiiv_send_to_newsletter',
	];
	const out = php( `
		$m = [];
		foreach ( ${ phpJson(
			keys
		) } as $k ) { $m[ $k ] = get_post_meta( ${ postId }, $k, true ); }
		echo "JSON=" . wp_json_encode( $m );
	` );
	return JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) );
}

/** beehiiv post-API calls (create/update/delete) logged since the last log start. */
function postApiCalls() {
	const out = php(
		'echo "JSON=" . wp_json_encode( beehiiv_e2e_get_http_log() );'
	);
	const log = JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) );
	return log
		.filter( ( entry ) =>
			/\/publications\/[^/]+\/posts(\/|$|\?)/.test( entry.url )
		)
		.map( ( entry ) => {
			const match = /\/publications\/([^/]+)\/posts(?:\/([^/?]+))?/.exec(
				entry.url
			);
			return {
				method: entry.method,
				publication: decodeURIComponent( match[ 1 ] ),
				beehiivPostId: match[ 2 ] || '',
			};
		} );
}

function resetLog() {
	php( 'beehiiv_e2e_start_http_log();' );
}

function isoInFuture( days ) {
	return new Date( Date.now() + days * 86400 * 1000 )
		.toISOString()
		.replace( /\.\d{3}Z$/, 'Z' );
}

/**
 * Site-local (UTC in wp-env) "Y-m-d\TH:i:s" for the custom send date meta.
 *
 * @param {number} days Days from now.
 * @return {string} Local datetime string.
 */
function localInFuture( days ) {
	return isoInFuture( days ).replace( 'Z', '' );
}

/**
 * Meta for a post already linked to a beehiiv post (scheduled unless scheduledAt is empty).
 *
 * @param {Object} options
 * @param {string} options.pub             Publication the beehiiv post lives in.
 * @param {string} options.template        Template it was created with.
 * @param {string} options.beehiivPostId   Linked beehiiv post ID.
 * @param {number} [options.scheduledDays] Days until the send; 0 means already sent.
 * @return {Object<string, string>} Post meta.
 */
function linkedMeta( { pub, template, beehiivPostId, scheduledDays = 3 } ) {
	const meta = {
		_beehiiv_publication_id: pub,
		_beehiiv_post_template_id: template,
		_beehiiv_post_id: beehiivPostId,
		_beehiiv_linked_publication_id: pub,
		_beehiiv_linked_post_template_id: template,
		_beehiiv_send_to_newsletter: '',
	};
	if ( scheduledDays ) {
		meta._beehiiv_scheduled_at = isoInFuture( scheduledDays );
		meta._beehiiv_send_to_newsletter_date = localInFuture( scheduledDays );
	}
	return meta;
}

async function openSidebar( page ) {
	const content = page.locator( '.beehiiv-post-settings-content' );
	if ( await content.isVisible().catch( () => false ) ) {
		return;
	}
	await page
		.getByRole( 'button', { name: 'beehiiv', exact: true } )
		.first()
		.click();
	await expect( content ).toBeVisible();
}

async function openEditorWithSidebar( page, postId ) {
	await openPostEditor( page, postId );
	await openSidebar( page );
}

async function selectedText( locator ) {
	return locator.evaluate( ( el ) =>
		el.selectedIndex >= 0 ? el.options[ el.selectedIndex ].text : ''
	);
}

async function optionTexts( locator ) {
	return locator.evaluate( ( el ) =>
		Array.from( el.options ).map( ( o ) => o.text )
	);
}

async function waitForTemplateOptions( page, expectedText ) {
	await expect( page.locator( TPL_SELECT ) ).toBeVisible( {
		timeout: 15000,
	} );
	await expect(
		page.locator( `${ TPL_SELECT } option`, { hasText: expectedText } )
	).toHaveCount( 1, { timeout: 15000 } );
	await expect( page.locator( TPL_SELECT ) ).toBeEnabled();
}

/**
 * Saves through the real editor save path (optionally editing post fields first).
 *
 * @param {import('@playwright/test').Page} page    Editor page.
 * @param {Object<string, *>}               [edits] Post fields to edit before saving.
 */
async function editorSave( page, edits = {} ) {
	const ok = await page.evaluate( async ( postEdits ) => {
		const { dispatch, select } = window.wp.data;
		if ( Object.keys( postEdits ).length ) {
			dispatch( 'core/editor' ).editPost( postEdits );
		}
		await dispatch( 'core/editor' ).savePost();
		return select( 'core/editor' ).didPostSaveRequestSucceed();
	}, edits );
	expect( ok ).toBe( true );
}

test.describe.configure( { mode: 'serial' } );

test.describe( 'Post-level publication selector (PRD-06.8.02)', () => {
	test.beforeAll( () => {
		ensurePluginActive();
		ensurePrettyPermalinks();
	} );

	test.beforeEach( async ( { page } ) => {
		seedWorld();
		await loginAsAdmin( page );
	} );

	test.afterAll( () => {
		const ids = createdPostIds.join( ',' );
		php( `
			beehiiv_e2e_reset_all();
			foreach ( array_filter( explode( ",", "${ ids }" ) ) as $id ) { wp_delete_post( (int) $id, true ); }
			$u = get_user_by( "login", "qa_pps_contrib" ); if ( $u ) { require_once ABSPATH . "wp-admin/includes/user.php"; wp_delete_user( $u->ID ); }
			delete_option( "beehiiv_settings" );
		` );
	} );

	// US-001 ---------------------------------------------------------------

	test( 'AC-001: Publication selector sits directly above the Post template dropdown and lists every connected publication by name', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-001',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );

		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		await expect(
			page
				.locator( '.beehiiv-newsletter-publication' )
				.getByText( 'Publication', { exact: true } )
		).toBeVisible();
		const texts = await optionTexts( pub );
		expect( texts ).toEqual(
			expect.arrayContaining( [ PUB_A.name, PUB_B.name ] )
		);

		await waitForTemplateOptions( page, 'Alpha Standard' );
		// Directly above: the template block is the publication block's next sibling.
		const nextIsTemplate = await page
			.locator( '.beehiiv-newsletter-publication' )
			.evaluate(
				( el ) =>
					!! el.nextElementSibling &&
					el.nextElementSibling.classList.contains(
						'beehiiv-newsletter-template'
					)
			);
		expect( nextIsTemplate ).toBe( true );
	} );

	test( 'AC-002: selector is shown when only one publication is connected', async ( {
		page,
	} ) => {
		seedWorld( { publications: [ PUB_A ] } );
		const id = createPost( {
			title: 'QA AC-002',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );

		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		expect( await optionTexts( pub ) ).toEqual( [ PUB_A.name ] );
		expect( await selectedText( pub ) ).toBe( PUB_A.name );
	} );

	test( 'AC-003: a new post preselects the site-wide default publication', async ( {
		page,
	} ) => {
		setSettings( { publication_id: PUB_B.id, post_template_id: 'tpl_b1' } );
		await page.goto( '/wp-admin/post-new.php' );
		await page.waitForSelector( 'iframe[name="editor-canvas"]', {
			timeout: 20000,
		} );
		const close = page
			.locator( '.components-modal__header button' )
			.first();
		if (
			await close
				.waitFor( { state: 'visible', timeout: 4000 } )
				.then( () => true )
				.catch( () => false )
		) {
			await close.click();
		}
		await openSidebar( page );
		await page.getByLabel( 'Send to newsletter' ).check();

		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		expect( await selectedText( pub ) ).toBe( PUB_B.name );
		await expect( pub ).toHaveValue( PUB_B.id );
	} );

	test( 'AC-004: with no site default the selector has nothing preselected and the post cannot send; the settings notice appears only when no publication is connected', async ( {
		page,
	} ) => {
		setSettings( { publication_id: '', post_template_id: '' } );
		const id = createPost( {
			title: 'QA AC-004',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );

		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		await expect( pub ).toHaveValue( '' );
		expect( await optionTexts( pub ) ).toEqual(
			expect.arrayContaining( [ PUB_A.name, PUB_B.name ] )
		);
		await expect(
			page.getByText( 'Choose a publication for this post.' )
		).toBeVisible();
		await expect(
			page.getByText( 'Choose a publication in', { exact: false } )
		).toHaveCount( 0 );

		// Publishing without choosing must not create a beehiiv post anywhere.
		resetLog();
		await editorSave( page, { status: 'publish' } );
		expect( postApiCalls().filter( ( c ) => c.method === 'POST' ) ).toEqual(
			[]
		);
		expect( readMeta( id )._beehiiv_post_id ).toBe( '' );

		// No publication connected at all -> the settings notice.
		seedWorld( {
			publications: [],
			settings: { publication_id: '', post_template_id: '' },
		} );
		const id2 = createPost( {
			title: 'QA AC-004 none',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id2 );
		await expect(
			page
				.locator( '.beehiiv-post-settings-content' )
				.getByText( 'Choose a publication in', { exact: false } )
		).toBeVisible();
		await expect( page.locator( PUB_SELECT ) ).toHaveCount( 0 );
	} );

	test( 'AC-005: a post with no stored publication is treated as using the site default', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-005 legacy',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		php( `delete_post_meta( ${ id }, "_beehiiv_publication_id" );` );
		await openEditorWithSidebar( page, id );

		const pub = page.locator( PUB_SELECT );
		expect( await selectedText( pub ) ).toBe( PUB_A.name );
		await waitForTemplateOptions( page, 'Alpha Standard (default)' );

		resetLog();
		await editorSave( page, { status: 'publish' } );
		const creates = postApiCalls().filter( ( c ) => c.method === 'POST' );
		expect( creates.map( ( c ) => c.publication ) ).toEqual( [ PUB_A.id ] );
		expect( readMeta( id )._beehiiv_linked_publication_id ).toBe(
			PUB_A.id
		);
	} );

	test( "AC-006: only users with publish rights can change a post's publication", async ( {
		page,
		browser,
	} ) => {
		const pass = 'qa-pps-' + Date.now();
		php( `
			$u = get_user_by( "login", "qa_pps_contrib" );
			if ( $u ) { wp_set_password( "${ pass }", $u->ID ); } else { wp_insert_user( [ "user_login" => "qa_pps_contrib", "user_pass" => "${ pass }", "user_email" => "qa_pps_contrib@example.test", "role" => "contributor" ] ); }
		` );
		const contribId = Number(
			/ID=(\d+)/.exec(
				php(
					'echo "ID=" . get_user_by( "login", "qa_pps_contrib" )->ID;'
				)
			)[ 1 ]
		);
		const id = createPost( {
			title: 'QA AC-006',
			meta: { _beehiiv_publication_id: PUB_A.id },
		} );
		php(
			`wp_update_post( [ "ID" => ${ id }, "post_author" => ${ contribId } ] );`
		);

		// Contributor: no beehiiv sidebar, and a direct REST meta write is refused.
		const ctx = await browser.newContext();
		const cpage = await ctx.newPage();
		await loginAs( cpage, 'qa_pps_contrib', pass );
		await openPostEditor( cpage, id );
		await expect(
			cpage.getByRole( 'button', { name: 'beehiiv', exact: true } )
		).toHaveCount( 0 );
		const contribResult = await cpage.evaluate( async ( postId ) => {
			try {
				await window.wp.apiFetch( {
					path: `/wp/v2/posts/${ postId }`,
					method: 'POST',
					data: { meta: { _beehiiv_publication_id: 'pub_qa_beta' } },
				} );
				return 'ok';
			} catch ( e ) {
				return e.code || 'error';
			}
		}, id );
		await ctx.close();
		expect( contribResult ).not.toBe( 'ok' );
		expect( readMeta( id )._beehiiv_publication_id ).toBe( PUB_A.id );

		// Admin (publish rights) can change it through the same REST path.
		await openPostEditor( page, id );
		const adminResult = await page.evaluate( async ( postId ) => {
			await window.wp.apiFetch( {
				path: `/wp/v2/posts/${ postId }`,
				method: 'POST',
				data: { meta: { _beehiiv_publication_id: 'pub_qa_beta' } },
			} );
			return 'ok';
		}, id );
		expect( adminResult ).toBe( 'ok' );
		expect( readMeta( id )._beehiiv_publication_id ).toBe( PUB_B.id );
	} );

	// US-002 ---------------------------------------------------------------

	test( "AC-007: Post template list shows only the chosen publication's templates", async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-007',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_B.id,
			},
		} );
		await openEditorWithSidebar( page, id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		const texts = await optionTexts( page.locator( TPL_SELECT ) );
		expect( texts ).toEqual(
			expect.arrayContaining( [ 'Beta Classic', 'Beta Digest' ] )
		);
		expect( texts.some( ( t ) => t.startsWith( 'Alpha' ) ) ).toBe( false );
	} );

	test( 'AC-008: Refresh templates refreshes only the chosen publication', async ( {
		page,
	} ) => {
		php(
			`beehiiv_e2e_mock_http( "/publications/${ PUB_B.id }/post_templates", [ "body" => [ "data" => [ [ "id" => "tpl_b1", "name" => "Beta Classic" ], [ "id" => "tpl_b3", "name" => "Beta Fresh" ] ] ] ] );`
		);
		const id = createPost( {
			title: 'QA AC-008',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_B.id,
			},
		} );
		await openEditorWithSidebar( page, id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		resetLog();

		const refreshReq = page.waitForRequest(
			( r ) =>
				r.url().includes( 'post-templates' ) &&
				/refresh=1/.test( r.url() )
		);
		await page.getByRole( 'button', { name: 'Refresh templates' } ).click();
		const req = await refreshReq;
		expect( decodeURIComponent( req.url() ) ).toContain(
			`publication_id=${ PUB_B.id }`
		);
		await waitForTemplateOptions( page, 'Beta Fresh' );

		const outbound = JSON.parse(
			( ( o ) => o.slice( o.indexOf( 'JSON=' ) + 5 ) )(
				php(
					'echo "JSON=" . wp_json_encode( beehiiv_e2e_get_http_log() );'
				)
			)
		);
		const templateFetches = outbound.filter( ( e ) =>
			/post_templates/.test( e.url )
		);
		expect( templateFetches.length ).toBeGreaterThan( 0 );
		expect(
			templateFetches.every( ( e ) =>
				e.url.includes( `/publications/${ PUB_B.id }/` )
			)
		).toBe( true );
		// The other publication's cache was not touched.
		const aCache = php(
			`echo "JSON=" . wp_json_encode( \\Beehiiv\\API\\Cache::get_post_templates( "${ PUB_A.id }" ) );`
		);
		expect(
			JSON.parse( aCache.slice( aCache.indexOf( 'JSON=' ) + 5 ) )
		).toEqual( TEMPLATES[ PUB_A.id ] );
	} );

	test( "AC-009: changing the publication clears the template and loads the new publication's list", async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-009',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_A.id,
				_beehiiv_post_template_id: 'tpl_a2',
			},
		} );
		await openEditorWithSidebar( page, id );
		await waitForTemplateOptions( page, 'Alpha Promo' );
		await expect( page.locator( TPL_SELECT ) ).toHaveValue( 'tpl_a2' );

		await page.locator( PUB_SELECT ).selectOption( PUB_B.id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		await expect( page.locator( TPL_SELECT ) ).toHaveValue( '' );
		const texts = await optionTexts( page.locator( TPL_SELECT ) );
		expect( texts.some( ( t ) => t.startsWith( 'Alpha' ) ) ).toBe( false );
		const editedTemplate = await page.evaluate(
			() =>
				window.wp.data
					.select( 'core/editor' )
					.getEditedPostAttribute( 'meta' )._beehiiv_post_template_id
		);
		expect( editedTemplate ).toBe( '' );
	} );

	test( 'AC-010: on the default publication the settings default template appears once as "Name (default)" and is preselected', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-010',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );
		await waitForTemplateOptions( page, 'Alpha Standard (default)' );
		const tpl = page.locator( TPL_SELECT );
		const texts = await optionTexts( tpl );
		expect( texts.filter( ( t ) => t.includes( '(default)' ) ) ).toEqual( [
			'Alpha Standard (default)',
		] );
		expect(
			texts.some( ( t ) => /Default \(from beehiiv settings\)/.test( t ) )
		).toBe( false );
		expect( await selectedText( tpl ) ).toBe( 'Alpha Standard (default)' );
	} );

	test( 'AC-011: on a non-default publication templates have plain names, none is preselected, and a pick is required', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-011',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_B.id,
			},
		} );
		await openEditorWithSidebar( page, id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		const tpl = page.locator( TPL_SELECT );
		const texts = await optionTexts( tpl );
		expect( texts.some( ( t ) => t.includes( '(default)' ) ) ).toBe(
			false
		);
		await expect( tpl ).toHaveValue( '' );
		await expect(
			page.getByText( 'Pick a post template for this post.' )
		).toBeVisible();

		// Publishing without a pick does not create a beehiiv post.
		resetLog();
		await editorSave( page, { status: 'publish' } );
		expect( postApiCalls().filter( ( c ) => c.method === 'POST' ) ).toEqual(
			[]
		);
		expect( readMeta( id )._beehiiv_post_id ).toBe( '' );
	} );

	// US-003 ---------------------------------------------------------------

	test( "AC-012: the newsletter is created in the post's publication and that publication is recorded", async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-012',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );
		await page.locator( PUB_SELECT ).selectOption( PUB_B.id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		await page.locator( TPL_SELECT ).selectOption( 'tpl_b1' );

		resetLog();
		await editorSave( page, { status: 'publish' } );
		const creates = postApiCalls().filter( ( c ) => c.method === 'POST' );
		expect( creates.map( ( c ) => c.publication ) ).toEqual( [ PUB_B.id ] );
		const meta = readMeta( id );
		expect( meta._beehiiv_post_id ).toBe( CREATED_ID[ PUB_B.id ] );
		expect( meta._beehiiv_linked_publication_id ).toBe( PUB_B.id );
		expect( meta._beehiiv_publication_id ).toBe( PUB_B.id );
		expect( meta._beehiiv_linked_post_template_id ).toBe( 'tpl_b1' );
	} );

	test( 'AC-013: later sync and cancel use the recorded publication even after the site default changes', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-013',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_A.id,
				template: 'tpl_a1',
				beehiivPostId: 'bh_alpha_old',
			} ),
		} );
		// Admin switches the site default after the post was scheduled.
		setSettings( { publication_id: PUB_B.id, post_template_id: 'tpl_b1' } );
		resetLog();

		await openEditorWithSidebar( page, id );
		await editorSave( page, { title: 'QA AC-013 edited' } );
		let calls = postApiCalls();
		expect( calls.length ).toBeGreaterThan( 0 );
		expect( calls.every( ( c ) => c.publication === PUB_A.id ) ).toBe(
			true
		);

		resetLog();
		await editorSave( page, { status: 'draft' } );
		calls = postApiCalls();
		expect( calls.some( ( c ) => c.method === 'DELETE' ) ).toBe( true );
		expect( calls.every( ( c ) => c.publication === PUB_A.id ) ).toBe(
			true
		);
	} );

	test( 'AC-014: changing the publication on a scheduled, unsent post moves the beehiiv post on save', async ( {
		page,
	} ) => {
		// Move to a non-default publication with the editor's template pick.
		const id = createPost( {
			title: 'QA AC-014',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_A.id,
				template: 'tpl_a1',
				beehiivPostId: 'bh_alpha_old',
			} ),
		} );
		await openEditorWithSidebar( page, id );
		await expect( page.locator( PUB_SELECT ) ).toBeEnabled();
		await page.locator( PUB_SELECT ).selectOption( PUB_B.id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		await page.locator( TPL_SELECT ).selectOption( 'tpl_b1' );
		resetLog();
		await editorSave( page );

		let calls = postApiCalls();
		expect( calls ).toEqual(
			expect.arrayContaining( [
				{
					method: 'DELETE',
					publication: PUB_A.id,
					beehiivPostId: 'bh_alpha_old',
				},
				{ method: 'POST', publication: PUB_B.id, beehiivPostId: '' },
			] )
		);
		let meta = readMeta( id );
		expect( meta._beehiiv_post_id ).toBe( CREATED_ID[ PUB_B.id ] );
		expect( meta._beehiiv_linked_publication_id ).toBe( PUB_B.id );
		expect( meta._beehiiv_linked_post_template_id ).toBe( 'tpl_b1' );

		// Move back to the default publication with no pick -> settings default template.
		const id2 = createPost( {
			title: 'QA AC-014 back',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_B.id,
				template: 'tpl_b1',
				beehiivPostId: 'bh_beta_old',
			} ),
		} );
		await openEditorWithSidebar( page, id2 );
		await page.locator( PUB_SELECT ).selectOption( PUB_A.id );
		await waitForTemplateOptions( page, 'Alpha Standard (default)' );
		resetLog();
		await editorSave( page );
		calls = postApiCalls();
		expect( calls ).toEqual(
			expect.arrayContaining( [
				{
					method: 'DELETE',
					publication: PUB_B.id,
					beehiivPostId: 'bh_beta_old',
				},
				{ method: 'POST', publication: PUB_A.id, beehiivPostId: '' },
			] )
		);
		meta = readMeta( id2 );
		expect( meta._beehiiv_post_id ).toBe( CREATED_ID[ PUB_A.id ] );
		expect( meta._beehiiv_linked_publication_id ).toBe( PUB_A.id );
		expect( meta._beehiiv_linked_post_template_id ).toBe( 'tpl_a1' );
	} );

	test( 'AC-015: after unpublishing cancels the beehiiv post, the selector is editable and a re-send uses the newly selected publication', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-015',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_A.id,
				template: 'tpl_a1',
				beehiivPostId: 'bh_alpha_old',
			} ),
		} );
		await openEditorWithSidebar( page, id );
		resetLog();
		await editorSave( page, { status: 'draft' } );
		expect( postApiCalls() ).toEqual(
			expect.arrayContaining( [
				{
					method: 'DELETE',
					publication: PUB_A.id,
					beehiivPostId: 'bh_alpha_old',
				},
			] )
		);
		expect( readMeta( id )._beehiiv_post_id ).toBe( '' );
		php(
			`delete_post_meta( ${ id }, "_beehiiv_send_to_newsletter_date" );`
		);

		await openEditorWithSidebar( page, id );
		await expect( page.locator( PUB_SELECT ) ).toBeEnabled();
		await page.locator( PUB_SELECT ).selectOption( PUB_B.id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		await page.locator( TPL_SELECT ).selectOption( 'tpl_b1' );
		resetLog();
		await editorSave( page, { status: 'publish' } );
		const creates = postApiCalls().filter( ( c ) => c.method === 'POST' );
		expect( creates.map( ( c ) => c.publication ) ).toEqual( [ PUB_B.id ] );
		expect( readMeta( id )._beehiiv_linked_publication_id ).toBe(
			PUB_B.id
		);
	} );

	// US-004 ---------------------------------------------------------------

	test( 'AC-016: once beehiiv has sent the newsletter, the selector is read-only and shows the publication name', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-016',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_B.id,
				template: 'tpl_b1',
				beehiivPostId: 'bh_beta_sent',
				scheduledDays: 0,
			} ),
		} );
		await openEditorWithSidebar( page, id );
		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		await expect( pub ).toBeDisabled();
		expect( await selectedText( pub ) ).toBe( PUB_B.name );

		// Server-side lock: a direct REST write of the publication is ignored.
		await page.evaluate( async ( postId ) => {
			await window.wp
				.apiFetch( {
					path: `/wp/v2/posts/${ postId }`,
					method: 'POST',
					data: { meta: { _beehiiv_publication_id: 'pub_qa_alpha' } },
				} )
				.catch( () => null );
		}, id );
		expect( readMeta( id )._beehiiv_publication_id ).toBe( PUB_B.id );
	} );

	test( 'AC-017: template dropdown stays editable while scheduled-unsent and locks together with the publication once sent', async ( {
		page,
	} ) => {
		const scheduled = createPost( {
			title: 'QA AC-017 scheduled',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_A.id,
				template: 'tpl_a1',
				beehiivPostId: 'bh_alpha_sched',
			} ),
		} );
		await openEditorWithSidebar( page, scheduled );
		await waitForTemplateOptions( page, 'Alpha Promo' );
		await expect( page.locator( PUB_SELECT ) ).toBeEnabled();
		await expect( page.locator( TPL_SELECT ) ).toBeEnabled();

		const sent = createPost( {
			title: 'QA AC-017 sent',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_A.id,
				template: 'tpl_a1',
				beehiivPostId: 'bh_alpha_sent',
				scheduledDays: 0,
			} ),
		} );
		await openEditorWithSidebar( page, sent );
		await expect( page.locator( TPL_SELECT ) ).toBeVisible( {
			timeout: 15000,
		} );
		await expect( page.locator( PUB_SELECT ) ).toBeDisabled();
		await expect( page.locator( TPL_SELECT ) ).toBeDisabled();
	} );

	// US-005 ---------------------------------------------------------------

	test( 'AC-018: a post with a publication and its own template is ready even without a site default template', async ( {
		page,
	} ) => {
		setSettings( { publication_id: PUB_A.id, post_template_id: '' } );

		// Default publication, own template pick, no settings default template.
		const id = createPost( {
			title: 'QA AC-018 default',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );
		await expect(
			page.getByText( 'Pick a post template for this post.' )
		).toBeVisible();
		await waitForTemplateOptions( page, 'Alpha Promo' );
		await page.locator( TPL_SELECT ).selectOption( 'tpl_a2' );
		await expect(
			page.getByText( 'Pick a post template for this post.' )
		).toHaveCount( 0 );
		await expect( page.getByLabel( 'Send to newsletter' ) ).toBeEnabled();
		resetLog();
		await editorSave( page, { status: 'publish' } );
		expect(
			postApiCalls()
				.filter( ( c ) => c.method === 'POST' )
				.map( ( c ) => c.publication )
		).toEqual( [ PUB_A.id ] );
		expect( readMeta( id )._beehiiv_linked_post_template_id ).toBe(
			'tpl_a2'
		);

		// Non-default publication with its own template.
		const id2 = createPost( {
			title: 'QA AC-018 other',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_B.id,
				_beehiiv_post_template_id: 'tpl_b2',
			},
		} );
		await openEditorWithSidebar( page, id2 );
		await waitForTemplateOptions( page, 'Beta Digest' );
		await expect(
			page.getByText( 'Pick a post template for this post.' )
		).toHaveCount( 0 );
		resetLog();
		await editorSave( page, { status: 'publish' } );
		expect(
			postApiCalls()
				.filter( ( c ) => c.method === 'POST' )
				.map( ( c ) => c.publication )
		).toEqual( [ PUB_B.id ] );
	} );

	test( 'AC-019: a disconnected stored publication falls back to the default publication with an error notice', async ( {
		page,
	} ) => {
		const id = createPost( {
			title: 'QA AC-019',
			meta: {
				_beehiiv_send_to_newsletter: '1',
				_beehiiv_publication_id: PUB_GONE,
			},
		} );
		await openEditorWithSidebar( page, id );
		await expect(
			page.getByText(
				/no longer connected.*default publication "Alpha Daily"/
			)
		).toBeVisible();

		resetLog();
		await editorSave( page, { status: 'publish' } );
		expect(
			postApiCalls()
				.filter( ( c ) => c.method === 'POST' )
				.map( ( c ) => c.publication )
		).toEqual( [ PUB_A.id ] );
		const meta = readMeta( id );
		expect( meta._beehiiv_linked_publication_id ).toBe( PUB_A.id );
		expect( meta._beehiiv_newsletter_error_type ).toBe(
			'publication_fallback'
		);

		await openEditorWithSidebar( page, id );
		const notice = page
			.locator( '.beehiiv-post-settings-content' )
			.getByText(
				/no longer connected, so this newsletter was sent to the default publication "Alpha Daily"/
			);
		await expect( notice ).toBeVisible();
	} );

	// US-006 ---------------------------------------------------------------

	test( 'AC-020: settings publication field reads "Default publication" with preselect help text; stored settings shape unchanged', async ( {
		page,
	} ) => {
		await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		const select = page.locator( '#beehiiv_publication_id' );
		await expect( select ).toBeVisible();
		await expect(
			page.locator( 'label[for="beehiiv_publication_id"]' )
		).toHaveText( 'Default publication' );
		await expect(
			select.locator(
				'xpath=following-sibling::p[contains(@class,"description")]'
			)
		).toContainText( 'Preselected on new posts' );
		await expect( select ).toHaveAttribute(
			'name',
			'beehiiv_settings[publication_id]'
		);
		await expect( select ).toHaveValue( PUB_A.id );
		// Saving through the relabelled field still stores the same keys.
		await page
			.locator( '#submit, input[type="submit"][name="submit"]' )
			.first()
			.click();
		await page.waitForLoadState( 'load' );
		const raw = php(
			'echo "JSON=" . wp_json_encode( get_option( "beehiiv_settings" ) );'
		);
		const stored = JSON.parse( raw.slice( raw.indexOf( 'JSON=' ) + 5 ) );
		expect( stored.publication_id ).toBe( PUB_A.id );
		expect( stored.post_template_id ).toBe( 'tpl_a1' );
		expect(
			Object.keys( stored ).some( ( k ) => /default/i.test( k ) )
		).toBe( false );
	} );

	test( 'AC-021: Refresh publications reloads the list from beehiiv bypassing the cache, keeps the selection, confirms, and the editor offers the refreshed list', async ( {
		page,
	} ) => {
		const PUB_C = { id: 'pub_qa_gamma', name: 'Gamma Monthly' };
		// The cache is freshly seeded with A + B; beehiiv itself now returns A + B + C.
		// Only the list call ("/publications?limit=...") is mocked, so per-publication post mocks are untouched.
		php(
			`beehiiv_e2e_mock_http( "/publications?", [ "body" => [ "data" => ${ phpJson(
				[ PUB_A, PUB_B, PUB_C ]
			) } ] ] );`
		);

		await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		const select = page.locator( '#beehiiv_publication_id' );
		await expect( select ).toBeVisible();
		await expect(
			select.locator( 'option', { hasText: PUB_C.name } )
		).toHaveCount( 0 );

		// Change the (unsaved) selection to B so "keeps the current selection" is a real check, not the saved default.
		await select.selectOption( PUB_B.id );
		resetLog();

		const button = page.getByRole( 'button', {
			name: 'Refresh publications',
		} );
		await expect( button ).toBeVisible();
		const restResp = page.waitForResponse(
			( r ) =>
				/publications/.test( decodeURIComponent( r.url() ) ) &&
				/refresh=1/.test( r.url() ) &&
				r.request().method() === 'GET'
		);
		await button.click();
		expect( ( await restResp ).status() ).toBe( 200 );

		await expect(
			page.getByText( 'Publications updated from beehiiv.' )
		).toBeVisible();
		await expect(
			select.locator( 'option', { hasText: PUB_C.name } )
		).toHaveCount( 1 );
		await expect( select ).toHaveValue( PUB_B.id );
		await expect( select ).toBeEnabled();
		await expect( button ).toBeEnabled();

		// The cache was bypassed: a real outbound list call to beehiiv happened despite a fresh cached list.
		const out = php(
			'echo "JSON=" . wp_json_encode( beehiiv_e2e_get_http_log() );'
		);
		const log = JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) );
		expect(
			log.some(
				( e ) => e.method === 'GET' && /\/publications\?/.test( e.url )
			)
		).toBe( true );

		// The post editor's Publication selector offers the refreshed list.
		const id = createPost( {
			title: 'QA AC-021',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );
		const pubSelect = page.locator( PUB_SELECT );
		await expect( pubSelect ).toBeVisible( { timeout: 15000 } );
		const texts = await optionTexts( pubSelect );
		expect( texts ).toEqual(
			expect.arrayContaining( [ PUB_A.name, PUB_B.name, PUB_C.name ] )
		);
	} );

	test( "AC-022: editor Refresh publications reloads the list from beehiiv bypassing the cache, keeps the post's choice, confirms, and is unavailable once sent", async ( {
		page,
	} ) => {
		const PUB_C = { id: 'pub_qa_gamma', name: 'Gamma Monthly' };
		// Cache is freshly seeded with A + B; beehiiv itself now returns A + B + C (list call only).
		php(
			`beehiiv_e2e_mock_http( "/publications?", [ "body" => [ "data" => ${ phpJson(
				[ PUB_A, PUB_B, PUB_C ]
			) } ] ] );`
		);

		const id = createPost( {
			title: 'QA AC-022',
			meta: { _beehiiv_send_to_newsletter: '1' },
		} );
		await openEditorWithSidebar( page, id );
		const box = page.locator( '.beehiiv-newsletter-publication' );
		const pub = page.locator( PUB_SELECT );
		await expect( pub ).toBeVisible();
		await expect(
			pub.locator( 'option', { hasText: PUB_C.name } )
		).toHaveCount( 0 );

		// Make the post's current (unsaved) choice B, not the site default A.
		await pub.selectOption( PUB_B.id );
		await waitForTemplateOptions( page, 'Beta Classic' );
		resetLog();

		const button = box.getByRole( 'button', {
			name: 'Refresh publications',
		} );
		await expect( button ).toBeVisible();
		await expect( button ).toBeEnabled();
		const restResp = page.waitForResponse(
			( r ) =>
				/beehiiv\/v1\/publications/.test(
					decodeURIComponent( r.url() )
				) &&
				/refresh=1/.test( r.url() ) &&
				r.request().method() === 'GET'
		);
		await button.click();
		expect( ( await restResp ).status() ).toBe( 200 );

		await expect(
			box.getByText( 'Publications updated from beehiiv.' )
		).toBeVisible();
		await expect(
			pub.locator( 'option', { hasText: PUB_C.name } )
		).toHaveCount( 1 );
		await expect( pub ).toHaveValue( PUB_B.id );
		await expect( pub ).toBeEnabled();
		await expect( button ).toBeEnabled();
		const edited = await page.evaluate(
			() =>
				window.wp.data
					.select( 'core/editor' )
					.getEditedPostAttribute( 'meta' )._beehiiv_publication_id
		);
		expect( edited ).toBe( PUB_B.id );

		// The cache was bypassed: a real outbound beehiiv list call happened despite a fresh cached list.
		const out = php(
			'echo "JSON=" . wp_json_encode( beehiiv_e2e_get_http_log() );'
		);
		const log = JSON.parse( out.slice( out.indexOf( 'JSON=' ) + 5 ) );
		expect(
			log.some(
				( e ) => e.method === 'GET' && /\/publications\?/.test( e.url )
			)
		).toBe( true );

		// Once beehiiv has sent the newsletter, the button is unavailable.
		const sent = createPost( {
			title: 'QA AC-022 sent',
			status: 'publish',
			meta: linkedMeta( {
				pub: PUB_B.id,
				template: 'tpl_b1',
				beehiivPostId: 'bh_beta_sent22',
				scheduledDays: 0,
			} ),
		} );
		await openEditorWithSidebar( page, sent );
		await expect( pub ).toBeDisabled();
		const sentButton = page
			.locator( '.beehiiv-newsletter-publication' )
			.getByRole( 'button', { name: 'Refresh publications' } );
		await expect( sentButton ).toBeVisible();
		await expect( sentButton ).toBeDisabled();
	} );
} );
