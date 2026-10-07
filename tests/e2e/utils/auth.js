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
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {string} password
 */
async function loginAs( page, username, password ) {
	await page.goto( '/wp-login.php' );

	const user = page.locator( '#user_login' );
	const pass = page.locator( '#user_pass' );

	// wp-login.php focuses and selects the username field ~200ms after load.
	// Wait for that first so it can't steal focus mid-fill and type the
	// password into the username field.
	await expect( user ).toBeFocused();

	await user.fill( username );
	await pass.fill( password );
	await expect( user ).toHaveValue( username );
	await expect( pass ).toHaveValue( password );

	await page.click( '#wp-submit' );
	await page.waitForURL( '**/wp-admin/**' );
}

module.exports = { loginAsAdmin, loginAs, ADMIN_USERNAME, ADMIN_PASSWORD };
