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
 * PRD: requirements/06-editor-integration/8-post-level-newsletter-overrides/post-level-newsletter-overrides.prd.md (v1.2)
 *
 * Independent behavioral coverage (qa-e2e-author), written from the PRD's
 * Acceptance Criteria plus the real code at the paths listed in
 * PLAN/EXECUTION's file lists:
 * - includes/Editor/Meta.php, includes/Editor/PostSettings.php -- the three
 *   meta keys and their publish_posts write gate.
 * - src/js/shared/meta.js, src/js/editor/post-settings/hooks/use-beehiiv-post-meta.js,
 *   src/js/editor/post-settings/index.js -- the two TextControls + one
 *   ToggleControl, and the "published by beehiiv" lock.
 *
 * The wording block only renders when the panel is "newsletter ready"
 * (connected + write permission + publication + default template) and
 * "Send to newsletter" is on, so beforeAll seeds that state through the
 * test-only mu-plugin seams in tests/e2e/plugins/beehiiv-options.php. Every
 * outbound beehiiv call is mocked; nothing reaches the live API.
 */

const META_TITLE = '_beehiiv_newsletter_title';
const META_SUBTITLE = '_beehiiv_newsletter_subtitle';
const META_SHOW = '_beehiiv_newsletter_show_title_in_email';
const META_SEND = '_beehiiv_send_to_newsletter';
const META_POST_ID = '_beehiiv_post_id';
const META_SCHEDULED_AT = '_beehiiv_scheduled_at';

const PUBLICATION_ID = 'pub_qa_e2e_overrides';
const TEMPLATE_ID = 'tpl_qa_e2e_overrides';
const MOCK_BEEHIIV_POST_ID = 'post_qa_e2e_overrides';

const AUTHOR_USERNAME = 'qa_e2e_author_overrides';
const AUTHOR_PASSWORD = 'qa-e2e-author-overrides-1!';
const CONTRIBUTOR_USERNAME = 'qa_e2e_contributor_overrides';
const CONTRIBUTOR_PASSWORD = 'qa-e2e-contrib-overrides-1!';

const SIDEBAR = '.beehiiv-post-settings';
const TITLE_LABEL = 'Newsletter title';
const SUBTITLE_LABEL = 'Newsletter subtitle';
const SHOW_LABEL = 'Show title and subtitle in email';

const createdPosts = [];
let authorId;
let contributorId;

function seedNewsletterReady() {
	wpCli(
		`eval 'beehiiv_e2e_seed_connection();
		beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] );
		update_option( "beehiiv_settings", [ "publication_id" => "${ PUBLICATION_ID }", "post_template_id" => "${ TEMPLATE_ID }" ] );
		beehiiv_e2e_seed_publications( [ [ "id" => "${ PUBLICATION_ID }", "name" => "QA E2E Publication" ] ] );
		beehiiv_e2e_seed_post_templates( "${ PUBLICATION_ID }", [ [ "id" => "${ TEMPLATE_ID }", "name" => "QA E2E Template" ] ] );
		beehiiv_e2e_mock_http( "/posts", [ "body" => [ "data" => [ "id" => "${ MOCK_BEEHIIV_POST_ID }" ] ] ] );'`
	);
}

function ensureUser( username, password, role ) {
	let id = wpCliSafe( `user get ${ username } --field=ID` );
	if ( ! id ) {
		id = wpCli(
			`user create ${ username } ${ username }@example.test --role=${ role } --user_pass="${ password }" --porcelain`
		);
	} else {
		wpCli(
			`user update ${ id } --user_pass="${ password }" --role=${ role }`
		);
	}
	return id;
}

/**
 * Creates a draft post with "Send to newsletter" on (so the wording block renders).
 *
 * @param {string}  title            Post title.
 * @param {Object}  [options]        Post options.
 * @param {number}  [options.author] Author user ID.
 * @param {boolean} [options.send]   Whether "Send to newsletter" is on.
 * @param {Object}  [options.meta]   Extra post meta to set.
 * @return {string} Post ID.
 */
function createPost( title, { author = 1, send = true, meta = {} } = {} ) {
	const id = wpCli(
		`post create --post_type=post --post_title="${ title }" --post_content="<!-- wp:paragraph --><p>QA E2E body content.</p><!-- /wp:paragraph -->" --post_status=draft --post_author=${ author } --porcelain`
	);
	createdPosts.push( id );
	if ( send ) {
		wpCli( `post meta update ${ id } ${ META_SEND } 1` );
	}
	for ( const [ key, value ] of Object.entries( meta ) ) {
		wpCli( `post meta update ${ id } ${ key } '${ value }'` );
	}
	return id;
}

function getMeta( id, key ) {
	const value = wpCliSafe( `post meta get ${ id } ${ key }` );
	return value === null ? '' : value;
}

function isoFromNow( ms ) {
	return new Date( Date.now() + ms )
		.toISOString()
		.replace( /\.\d{3}Z$/, 'Z' );
}

async function openSidebarFor( page, postId ) {
	await openPostEditor( page, postId );
	await openBeehiivSidebar( page );
	const sidebar = page.locator( SIDEBAR );
	await expect( sidebar.getByLabel( TITLE_LABEL ) ).toBeVisible( {
		timeout: 15000,
	} );
	return sidebar;
}

/**
 * Posts to the core REST posts endpoint from inside wp-admin, with the user's own cookie + nonce.
 *
 * @param {import('@playwright/test').Page} page   Playwright page, logged in.
 * @param {string|number}                   postId Post ID.
 * @param {Object}                          meta   Meta patch to send.
 * @return {Promise<Object>} `{ ok, meta }` on success, `{ ok: false, ... }` on error.
 */
async function restUpdateMeta( page, postId, meta ) {
	return page.evaluate(
		async ( { id, metaPatch } ) => {
			try {
				const res = await window.wp.apiFetch( {
					path: `/wp/v2/posts/${ id }`,
					method: 'POST',
					data: { meta: metaPatch },
				} );
				return { ok: true, meta: res.meta };
			} catch ( e ) {
				return { ok: false, code: e.code, status: e.data?.status };
			}
		},
		{ id: postId, metaPatch: meta }
	);
}

// Each test shells out to wp-cli several times (fixtures + DB assertions)
// on top of multiple editor loads, so the 30s default is too tight.
test.describe.configure( { timeout: 120 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
	authorId = ensureUser( AUTHOR_USERNAME, AUTHOR_PASSWORD, 'author' );
	contributorId = ensureUser(
		CONTRIBUTOR_USERNAME,
		CONTRIBUTOR_PASSWORD,
		'contributor'
	);
} );

test.beforeEach( async () => {
	seedNewsletterReady();
} );

test.afterAll( async () => {
	for ( const id of createdPosts ) {
		// Unlink first so deleting never tries to cancel a beehiiv newsletter.
		wpCliSafe( `post meta delete ${ id } ${ META_POST_ID }` );
		wpCliSafe( `post meta delete ${ id } ${ META_SCHEDULED_AT }` );
		wpCliSafe( `post delete ${ id } --force` );
	}
	wpCliSafe( `user delete ${ authorId } --yes` );
	wpCliSafe( `user delete ${ contributorId } --yes` );
	wpCliSafe( 'option delete beehiiv_settings' );
	wpCliSafe( `eval 'beehiiv_e2e_reset_all();'` );
} );

test.describe( 'US-001: newsletter title', () => {
	test( 'AC-001: the newsletter title field is in the beehiiv sidebar panel, not next to the post title', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-001' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toBeVisible();
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		await expect( canvas.getByText( TITLE_LABEL ) ).toHaveCount( 0 );
	} );

	test( 'AC-002: the newsletter title starts empty and is not pre-filled from the post title', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-002 post title' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toHaveValue( '' );
	} );

	test( 'AC-003: the newsletter title is saved per post and shown again on reopen', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-003' );
		const otherId = createPost( 'QA E2E overrides AC-003 (other post)' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar.getByLabel( TITLE_LABEL ).fill( 'Inbox subject AC-003' );
		await saveDraft( page );
		expect( getMeta( id, META_TITLE ) ).toBe( 'Inbox subject AC-003' );

		const reopened = await openSidebarFor( page, id );
		await expect( reopened.getByLabel( TITLE_LABEL ) ).toHaveValue(
			'Inbox subject AC-003'
		);

		// Per post: another post is unaffected.
		const other = await openSidebarFor( page, otherId );
		await expect( other.getByLabel( TITLE_LABEL ) ).toHaveValue( '' );
	} );

	test( 'AC-004: post title and newsletter title never change each other', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-004 original' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const postTitle = canvas.getByRole( 'textbox', { name: 'Add title' } );

		// Editing the post title leaves an empty newsletter title empty.
		await postTitle.fill( 'QA E2E overrides AC-004 edited post title' );
		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toHaveValue( '' );

		// Editing the newsletter title leaves the post title alone.
		await sidebar
			.getByLabel( TITLE_LABEL )
			.fill( 'Separate inbox wording' );
		await expect( postTitle ).toHaveText(
			'QA E2E overrides AC-004 edited post title'
		);

		// And editing the post title again leaves a set newsletter title alone.
		await postTitle.fill( 'QA E2E overrides AC-004 second edit' );
		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toHaveValue(
			'Separate inbox wording'
		);

		await saveDraft( page );
		expect( wpCli( `post get ${ id } --field=post_title` ) ).toBe(
			'QA E2E overrides AC-004 second edit'
		);
		expect( getMeta( id, META_TITLE ) ).toBe( 'Separate inbox wording' );
	} );

	test( 'AC-005: the newsletter title help text says it sets the email subject line', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-005' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );
		const field = sidebar.locator( '.beehiiv-newsletter-wording__title' );

		await expect( field ).toContainText( /email subject line/i );
		await expect( field ).not.toContainText( /headline|web version/i );
	} );
} );

test.describe( 'US-002: newsletter subtitle', () => {
	test( 'AC-006: the newsletter subtitle field is in the beehiiv sidebar panel', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-006' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toBeVisible();
	} );

	test( 'AC-007: the newsletter subtitle starts empty', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-007' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toHaveValue( '' );
	} );

	test( 'AC-008: the newsletter subtitle is saved per post and shown again on reopen', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-008' );
		const otherId = createPost( 'QA E2E overrides AC-008 (other post)' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar
			.getByLabel( SUBTITLE_LABEL )
			.fill( 'A subtitle for AC-008' );
		await saveDraft( page );
		expect( getMeta( id, META_SUBTITLE ) ).toBe( 'A subtitle for AC-008' );

		const reopened = await openSidebarFor( page, id );
		await expect( reopened.getByLabel( SUBTITLE_LABEL ) ).toHaveValue(
			'A subtitle for AC-008'
		);

		const other = await openSidebarFor( page, otherId );
		await expect( other.getByLabel( SUBTITLE_LABEL ) ).toHaveValue( '' );
	} );

	test( 'AC-009: the newsletter subtitle help text says it is the beehiiv subtitle, not preview text', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-009' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );
		const field = sidebar.locator(
			'.beehiiv-newsletter-wording__subtitle'
		);

		await expect( field ).toContainText( /beehiiv post subtitle/i );
		await expect( field ).not.toContainText( /preview text/i );
	} );
} );

test.describe( 'US-003: empty fields are safe', () => {
	test( 'AC-010 / AC-011: empty title and subtitle never block saving or sending', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-010-011' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		// Saving with both fields empty succeeds.
		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toHaveValue( '' );
		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toHaveValue( '' );
		await page
			.frameLocator( 'iframe[name="editor-canvas"]' )
			.getByRole( 'textbox', { name: 'Add title' } )
			.fill( 'QA E2E overrides AC-010-011 saved' );
		await saveDraft( page );
		expect( wpCli( `post get ${ id } --field=post_title` ) ).toBe(
			'QA E2E overrides AC-010-011 saved'
		);
		expect( getMeta( id, META_TITLE ) ).toBe( '' );
		expect( getMeta( id, META_SUBTITLE ) ).toBe( '' );

		// Sending with both fields empty succeeds (beehiiv create call mocked).
		wpCli( `post update ${ id } --post_status=publish` );
		wpCli(
			`eval '\\Beehiiv\\Newsletter\\Sender::send( ${ id } );' --user=1`
		);
		expect( getMeta( id, '_beehiiv_newsletter_error' ) ).toBe( '' );
		expect( getMeta( id, META_POST_ID ) ).toBe( MOCK_BEEHIIV_POST_ID );
	} );

	test( 'AC-012: empty fields display as empty, with help text saying the post title is used', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-012' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toHaveValue( '' );
		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toHaveValue( '' );
		await expect(
			sidebar.locator( '.beehiiv-newsletter-wording__title' )
		).toContainText( /post title/i );
	} );

	test( 'AC-013 / AC-026: saved title, subtitle and display choice are exposed on the post for Newsletter Send', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-013-026' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar.getByLabel( TITLE_LABEL ).fill( 'Send-side title' );
		await sidebar.getByLabel( SUBTITLE_LABEL ).fill( 'Send-side subtitle' );
		await sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } ).check();
		await saveDraft( page );

		// Stored as post meta (what Newsletter Send reads server-side)...
		expect( getMeta( id, META_TITLE ) ).toBe( 'Send-side title' );
		expect( getMeta( id, META_SUBTITLE ) ).toBe( 'Send-side subtitle' );
		expect( getMeta( id, META_SHOW ) ).toBe( '1' );

		// ...and readable through the REST post meta.
		const meta = await page.evaluate(
			async ( postId ) =>
				(
					await window.wp.apiFetch( {
						path: `/wp/v2/posts/${ postId }?context=edit`,
					} )
				).meta,
			id
		);
		expect( meta[ META_TITLE ] ).toBe( 'Send-side title' );
		expect( meta[ META_SUBTITLE ] ).toBe( 'Send-side subtitle' );
		expect( meta[ META_SHOW ] ).toBe( true );
	} );
} );

test.describe( 'US-004: only publishers edit them', () => {
	test( 'AC-014: a user with publish rights (author role) can see and edit both fields', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-014', {
			author: authorId,
		} );
		await loginAs( page, AUTHOR_USERNAME, AUTHOR_PASSWORD );
		const sidebar = await openSidebarFor( page, id );

		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toBeEnabled();
		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toBeEnabled();
		await sidebar.getByLabel( TITLE_LABEL ).fill( 'Author title' );
		await sidebar.getByLabel( SUBTITLE_LABEL ).fill( 'Author subtitle' );
		await saveDraft( page );

		expect( getMeta( id, META_TITLE ) ).toBe( 'Author title' );
		expect( getMeta( id, META_SUBTITLE ) ).toBe( 'Author subtitle' );
	} );

	test( 'AC-015 / AC-024: a user without publish rights cannot change the title, subtitle or display choice through REST', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-015-024', {
			author: contributorId,
			meta: {
				[ META_TITLE ]: 'Publisher title',
				[ META_SUBTITLE ]: 'Publisher subtitle',
			},
		} );
		await loginAs( page, CONTRIBUTOR_USERNAME, CONTRIBUTOR_PASSWORD );
		await openPostEditor( page, id );

		for ( const patch of [
			{ [ META_TITLE ]: 'Contributor title' },
			{ [ META_SUBTITLE ]: 'Contributor subtitle' },
			{ [ META_SHOW ]: true },
		] ) {
			const result = await restUpdateMeta( page, id, patch );
			expect(
				result.ok,
				`write of ${ Object.keys( patch )[ 0 ] } must be refused`
			).toBe( false );
			expect( result.status ).toBe( 403 );
		}

		expect( getMeta( id, META_TITLE ) ).toBe( 'Publisher title' );
		expect( getMeta( id, META_SUBTITLE ) ).toBe( 'Publisher subtitle' );
		expect( [ '', '0' ] ).toContain( getMeta( id, META_SHOW ) );
	} );

	test( 'AC-015 / AC-016: the beehiiv panel stays hidden for users without publish rights and shown for publishers', async ( {
		page,
	} ) => {
		const contribPost = createPost( 'QA E2E overrides AC-016 contributor', {
			author: contributorId,
		} );
		await loginAs( page, CONTRIBUTOR_USERNAME, CONTRIBUTOR_PASSWORD );
		await openPostEditor( page, contribPost );
		await expect(
			page.getByRole( 'button', { name: 'beehiiv', exact: true } )
		).toHaveCount( 0 );
		await expect( page.getByLabel( TITLE_LABEL ) ).toHaveCount( 0 );

		await page.context().clearCookies();
		const adminPost = createPost( 'QA E2E overrides AC-016 admin' );
		await loginAsAdmin( page );
		await openPostEditor( page, adminPost );
		await expect(
			page.getByRole( 'button', { name: 'beehiiv', exact: true } )
		).toBeVisible();
	} );
} );

test.describe( 'US-005: edits reach an unsent beehiiv newsletter', () => {
	test( 'AC-019 / AC-025: title, subtitle and display toggle stay editable while a linked newsletter is still scheduled', async ( {
		page,
	} ) => {
		// A real send turns "Send to newsletter" back off once the post is linked.
		const id = createPost( 'QA E2E overrides AC-019-025 scheduled', {
			send: false,
			meta: {
				[ META_POST_ID ]: 'post_qa_linked_scheduled',
				[ META_SCHEDULED_AT ]: isoFromNow( 7 * 24 * 60 * 60 * 1000 ),
			},
		} );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		// The panel's other controls lock once linked...
		await expect(
			sidebar.getByRole( 'checkbox', { name: 'Send to newsletter' } )
		).toBeDisabled();

		// ...but the wording fields and display toggle do not.
		await expect( sidebar.getByLabel( TITLE_LABEL ) ).toBeEnabled();
		await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toBeEnabled();
		await expect(
			sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } )
		).toBeEnabled();

		await sidebar.getByLabel( TITLE_LABEL ).fill( 'Scheduled edit title' );
		await sidebar
			.getByLabel( SUBTITLE_LABEL )
			.fill( 'Scheduled edit subtitle' );
		await sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } ).check();
		await saveDraft( page );

		expect( getMeta( id, META_TITLE ) ).toBe( 'Scheduled edit title' );
		expect( getMeta( id, META_SUBTITLE ) ).toBe(
			'Scheduled edit subtitle'
		);
		expect( getMeta( id, META_SHOW ) ).toBe( '1' );
	} );

	test( 'AC-018 / AC-019 / AC-025: title, subtitle and display toggle lock once beehiiv has published the newsletter', async ( {
		page,
	} ) => {
		// Sent immediately: linked with no scheduled time.
		const sentNow = createPost( 'QA E2E overrides AC-018 sent now', {
			send: false,
			meta: {
				[ META_POST_ID ]: 'post_qa_linked_sent',
				[ META_TITLE ]: 'Sent title',
			},
		} );
		// Scheduled time already passed.
		const sentLater = createPost(
			'QA E2E overrides AC-018 schedule passed',
			{
				send: false,
				meta: {
					[ META_POST_ID ]: 'post_qa_linked_past',
					[ META_SCHEDULED_AT ]: isoFromNow( -60 * 60 * 1000 ),
				},
			}
		);
		await loginAsAdmin( page );

		for ( const id of [ sentNow, sentLater ] ) {
			const sidebar = await openSidebarFor( page, id );
			await expect( sidebar.getByLabel( TITLE_LABEL ) ).toBeDisabled();
			await expect( sidebar.getByLabel( SUBTITLE_LABEL ) ).toBeDisabled();
			await expect(
				sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } )
			).toBeDisabled();
		}
		expect( getMeta( sentNow, META_TITLE ) ).toBe( 'Sent title' );
	} );
} );

test.describe( 'US-006: show or hide the title and subtitle in the email', () => {
	test( 'AC-020 / AC-023: one "show title and subtitle in email" toggle covers both, with explanatory help text', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-020-023' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } )
		).toHaveCount( 1 );
		// No separate per-field show/hide controls.
		await expect(
			sidebar.getByRole( 'checkbox', { name: /show.*(title|subtitle)/i } )
		).toHaveCount( 1 );
		await expect(
			sidebar.locator( '.beehiiv-newsletter-wording__show-title' )
		).toContainText( /title and subtitle.*email/i );
	} );

	test( 'AC-021: the toggle is off for a post where it was never set (including pre-existing posts)', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-021' );
		// A post created "before the feature" has no row for the meta at all.
		wpCliSafe( `post meta delete ${ id } ${ META_SHOW }` );
		expect(
			wpCliSafe( `post meta get ${ id } ${ META_SHOW }` ) || ''
		).toBe( '' );

		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await expect(
			sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } )
		).not.toBeChecked();
		const meta = await page.evaluate(
			async ( postId ) =>
				(
					await window.wp.apiFetch( {
						path: `/wp/v2/posts/${ postId }?context=edit`,
					} )
				).meta,
			id
		);
		expect( meta[ META_SHOW ] ).toBe( false );
	} );

	test( 'AC-022: the display choice is saved per post and shown again on reopen', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-022' );
		const otherId = createPost( 'QA E2E overrides AC-022 (other post)' );
		await loginAsAdmin( page );
		const sidebar = await openSidebarFor( page, id );

		await sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } ).check();
		await saveDraft( page );
		expect( getMeta( id, META_SHOW ) ).toBe( '1' );

		const reopened = await openSidebarFor( page, id );
		await expect(
			reopened.getByRole( 'checkbox', { name: SHOW_LABEL } )
		).toBeChecked();

		// Turning it back off also persists.
		await reopened.getByRole( 'checkbox', { name: SHOW_LABEL } ).uncheck();
		await saveDraft( page );
		expect( [ '', '0' ] ).toContain( getMeta( id, META_SHOW ) );

		const other = await openSidebarFor( page, otherId );
		await expect(
			other.getByRole( 'checkbox', { name: SHOW_LABEL } )
		).not.toBeChecked();
	} );

	test( 'AC-024: a publisher (author role) can change the display choice', async ( {
		page,
	} ) => {
		const id = createPost( 'QA E2E overrides AC-024 author', {
			author: authorId,
		} );
		await loginAs( page, AUTHOR_USERNAME, AUTHOR_PASSWORD );
		const sidebar = await openSidebarFor( page, id );

		await sidebar.getByRole( 'checkbox', { name: SHOW_LABEL } ).check();
		await saveDraft( page );
		expect( getMeta( id, META_SHOW ) ).toBe( '1' );
	} );
} );
