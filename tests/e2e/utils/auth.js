const ADMIN_USERNAME = process.env.WP_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

/**
 * Logs into wp-admin as the wp-env default administrator.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdmin( page ) {
	await page.goto( '/wp-login.php' );
	await page.fill( '#user_login', ADMIN_USERNAME );
	await page.fill( '#user_pass', ADMIN_PASSWORD );
	await page.click( '#wp-submit' );
	await page.waitForURL( '**/wp-admin/**' );
}

module.exports = { loginAsAdmin, ADMIN_USERNAME, ADMIN_PASSWORD };
