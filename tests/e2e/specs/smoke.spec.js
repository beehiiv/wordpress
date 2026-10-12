const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );

test.describe( 'E2E environment setup', () => {
	test( 'admin can log in and the beehiiv plugin is active', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );

		await page.goto( '/wp-admin/plugins.php' );
		const row = page.locator( 'tr[data-slug="beehiiv"]' );
		await expect( row ).toHaveClass( /active/ );
	} );
} );
