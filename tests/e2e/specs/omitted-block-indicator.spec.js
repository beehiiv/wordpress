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
 * Editor marks for blocks the beehiiv newsletter leaves out.
 *
 * An omitted block gets a class on its own element (no wrapper element), a
 * hidden-eye icon, and a count in the sidebar notice. The marks show only while
 * the beehiiv sidebar is open, for a post that is queued to send or linked to a
 * newsletter that has not been sent yet.
 */

const META = {
	send: '_beehiiv_send_to_newsletter',
	postId: '_beehiiv_post_id',
};

const PUBLICATION_ID = 'pub_qa_e2e_omitted';
const TEMPLATE_ID = 'tpl_qa_e2e_omitted';

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
 * Seeds a connected site that is ready to send.
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
		beehiiv_e2e_clear_http_log();`
	);
}

/**
 * Creates a post fixture in the DB.
 *
 * @param {Object} options          Post fields.
 * @param {string} options.title    Post title.
 * @param {string} options.content  Post content (block markup).
 * @param {Object} [options.meta]   Post meta to set.
 * @param {string} [options.status] Post status.
 * @return {string} Post ID.
 */
function createPost( { title, content, meta = {}, status = 'draft' } ) {
	const post = {
		post_type: 'post',
		post_title: title,
		post_content: content,
		post_status: status,
		post_author: 1,
	};
	const id = wpEvalWith(
		{ post, meta },
		`$id = wp_insert_post( $a["post"] );
		foreach ( $a["meta"] as $k => $v ) { update_post_meta( $id, $k, $v ); }
		echo $id . "\\n";`
	);
	createdPosts.push( id );
	return id;
}

/**
 * Opens or closes the beehiiv sidebar, whatever state the editor remembered.
 *
 * @param {import('@playwright/test').Page} page Editor page.
 * @param {boolean}                         open Whether the sidebar should be open.
 */
async function setBeehiivSidebar( page, open ) {
	const content = page.locator( '.beehiiv-post-settings-content' );
	const remembered = await content
		.waitFor( { state: 'visible', timeout: 3000 } )
		.then( () => true )
		.catch( () => false );
	if ( remembered !== open ) {
		await page
			.getByRole( 'button', { name: 'beehiiv', exact: true } )
			.first()
			.click();
	}
	if ( open ) {
		await expect( content ).toBeVisible();
	} else {
		await expect( content ).toBeHidden();
	}
}

/**
 * Meta for a post linked to a beehiiv newsletter that sends at the given time.
 *
 * @param {string} scheduledAt UTC ISO 8601 send time.
 * @return {Object} Post meta.
 */
function linkedMeta( scheduledAt ) {
	return {
		[ META.postId ]: 'post_qa_e2e_omitted',
		_beehiiv_publication_id: PUBLICATION_ID,
		_beehiiv_post_template_id: TEMPLATE_ID,
		_beehiiv_linked_publication_id: PUBLICATION_ID,
		_beehiiv_linked_post_template_id: TEMPLATE_ID,
		[ META.send ]: '',
		_beehiiv_scheduled_at: scheduledAt,
	};
}

const p = ( text ) =>
	`<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
// A Code block has no beehiiv equivalent, so the newsletter leaves it out.
const code = ( text ) =>
	`<!-- wp:code --><pre class="wp-block-code"><code>${ text }</code></pre><!-- /wp:code -->`;

test.describe.configure( { timeout: 150 * 1000 } );

test.beforeAll( async () => {
	ensurePluginActive();
	ensurePrettyPermalinks();
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
} );

test.describe( 'Omitted block marks in the editor', () => {
	test( 'a queued post marks the omitted block on the block itself, only while the sidebar is open', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E omitted block',
			content: p( 'Kept text' ) + code( 'Left out' ),
			meta: { [ META.send ]: '1' },
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		await setBeehiivSidebar( page, true );

		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toContainText( '1 block will be omitted from this newsletter.' );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
		const marked = canvas.locator( '.beehiiv-omitted-block' );
		await expect( marked ).toHaveCount( 1 );

		// The class sits on the Code block's own element; no wrapper element is added.
		await expect(
			canvas.locator( '.wp-block-code.beehiiv-omitted-block' )
		).toHaveCount( 1 );
		await expect(
			canvas.locator( '.beehiiv-omitted-block:not(.wp-block)' )
		).toHaveCount( 0 );

		// The hidden-eye icon is always drawn, without hovering the block.
		const icon = await marked.evaluate( ( el ) => {
			const style = window.getComputedStyle( el, '::after' );
			return { content: style.content, opacity: style.opacity };
		} );
		expect( icon.content ).not.toBe( 'none' );
		expect( icon.opacity ).toBe( '1' );

		// Closing the beehiiv sidebar removes the marks from the canvas.
		await setBeehiivSidebar( page, false );
		await expect( marked ).toHaveCount( 0 );
		await setBeehiivSidebar( page, true );
		await expect( marked ).toHaveCount( 1 );
	} );

	test( 'a scheduled, linked post shows the notice and marks, and a sent one does not', async ( {
		page,
	} ) => {
		seed();
		const content = p( 'Kept text' ) + code( 'Left out' );
		const scheduledId = createPost( {
			title: 'QA E2E scheduled omitted block',
			content,
			status: 'publish',
			meta: linkedMeta( '2031-01-01T10:00:00Z' ),
		} );
		const sentId = createPost( {
			title: 'QA E2E sent omitted block',
			content,
			status: 'publish',
			meta: linkedMeta( '2020-01-01T10:00:00Z' ),
		} );
		await loginAsAdmin( page );
		const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );

		await openPostEditor( page, scheduledId );
		await setBeehiivSidebar( page, true );
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toContainText( '1 block will be omitted from this newsletter.' );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			1
		);

		await openPostEditor( page, sentId );
		await setBeehiivSidebar( page, true );
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCount( 0 );
		await expect( canvas.locator( '.beehiiv-omitted-block' ) ).toHaveCount(
			0
		);
	} );

	test( 'a post whose blocks are all supported shows no notice or marks', async ( {
		page,
	} ) => {
		seed();
		const id = createPost( {
			title: 'QA E2E no omitted blocks',
			content: p( 'Only supported text' ),
			meta: { [ META.send ]: '1' },
		} );
		await loginAsAdmin( page );
		await openPostEditor( page, id );
		await setBeehiivSidebar( page, true );

		await expect(
			page.locator( '.beehiiv-post-settings-notice__text' )
		).toBeVisible();
		await expect(
			page.locator( '.beehiiv-post-settings-notice__omitted' )
		).toHaveCount( 0 );
		await expect(
			page
				.frameLocator( 'iframe[name="editor-canvas"]' )
				.locator( '.beehiiv-omitted-block' )
		).toHaveCount( 0 );
	} );
} );
