const { expect } = require( '@playwright/test' );

/**
 * Opens the block editor for a post and dismisses the first-login welcome
 * guide if it appears.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string|number} postId
 */
async function openPostEditor( page, postId ) {
	await page.goto( `/wp-admin/post.php?post=${ postId }&action=edit` );
	await page.waitForSelector( 'iframe[name="editor-canvas"]', { timeout: 20000 } );

	// Dismiss the "Welcome to the editor" guide if it appears -- a modal shown
	// once per user (persisted server-side), rendered asynchronously after
	// the canvas iframe exists, so wait for it rather than a one-shot check.
	// Escape did not reliably close it in practice; click its header close
	// button directly instead.
	const closeButton = page.locator( '.components-modal__header button' ).first();
	const appeared = await closeButton.waitFor( { state: 'visible', timeout: 4000 } ).then( () => true ).catch( () => false );
	if ( appeared ) {
		await closeButton.click();
		await closeButton.waitFor( { state: 'hidden', timeout: 5000 } ).catch( () => {} );
	}
}

/** Opens the beehiiv plugin sidebar panel (call after openPostEditor). */
async function openBeehiivSidebar( page ) {
	await page.getByRole( 'button', { name: 'beehiiv', exact: true } ).click();
}

/**
 * Clicks "Save draft" and waits for the save to actually complete.
 *
 * Neither the button's post-save text nor its enabled state is a stable
 * thing to assert on -- once there's nothing left to save, the button can
 * disappear entirely rather than re-enable. Wait on the real REST save
 * request completing instead, which is unambiguous regardless of UI state.
 */
async function saveDraft( page ) {
	const saveButton = page.getByRole( 'button', { name: 'Save draft' } );
	const saved = page.waitForResponse(
		( res ) =>
			/\/wp-json\/wp\/v2\/posts\/\d+/.test( res.url() ) &&
			res.request().method() !== 'GET',
		{ timeout: 15000 }
	);
	await saveButton.click();
	await saved;
}

module.exports = { openPostEditor, openBeehiivSidebar, saveDraft };
