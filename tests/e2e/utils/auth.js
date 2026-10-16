const { expect } = require( '@playwright/test' );

const ADMIN_USERNAME = process.env.WP_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

/**
 * Logs into wp-admin as the wp-env default administrator.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdmin( page ) {
	await loginAs( page, ADMIN_USERNAME, ADMIN_PASSWORD );
}

/**
 * Logs into wp-admin as any user via the real login form (cookie/session
 * auth) -- for UI-driven tests where a REST Application Password wouldn't
 * apply.
 *
 * wp-login.php focuses and selects the username field on a ~200ms timer
 * after load. When that timer fires mid-fill, the password lands in the
 * username field and the empty password blocks the submit. Re-filling
 * until both fields hold the expected values sidesteps the race; the timer
 * only fires once, so the values can't change again before the click.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          username
 * @param {string}                          password
 */
async function loginAs( page, username, password ) {
	await page.goto( '/wp-login.php' );

	const user = page.locator( '#user_login' );
	const pass = page.locator( '#user_pass' );

	// wp-login.php focuses a field ~200ms after load: the username field, or
	// the password field (clearing it) when the username is pre-filled from an
	// earlier login. Wait for that first so it can't steal focus or clear a
	// value mid-fill.
	await expect(
		page.locator( '#user_login:focus, #user_pass:focus' )
	).toHaveCount( 1 );

	// Re-fill until both fields hold the expected values, in case a late focus
	// change still lands between the two fills.
	await expect( async () => {
		await user.fill( username );
		await pass.fill( password );
		await expect( user ).toHaveValue( username, { timeout: 1000 } );
		await expect( pass ).toHaveValue( password, { timeout: 1000 } );
	} ).toPass( { timeout: 10000 } );

	await page.click( '#wp-submit' );
	await page.waitForURL( '**/wp-admin/**' );
}

module.exports = { loginAsAdmin, loginAs, ADMIN_USERNAME, ADMIN_PASSWORD };
