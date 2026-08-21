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
	await page.fill( '#user_login', username );
	await page.fill( '#user_pass', password );
	await page.click( '#wp-submit' );
	await page.waitForURL( '**/wp-admin/**' );
}

module.exports = { loginAsAdmin, loginAs, ADMIN_USERNAME, ADMIN_PASSWORD };
