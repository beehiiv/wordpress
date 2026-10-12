const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/2-admin-menu/menu-registration.prd.md
 *
 * Non-admin fixture user for AC-004. Created idempotently (reused across
 * repeated runs against this shared wp-env tests environment, matching the
 * `ensurePluginActive`-style pattern in utils/wp-cli.js) with the Editor
 * role, which does not carry `manage_options` -- the capability the beehiiv
 * menu item is registered under (includes/Admin/Menu.php).
 */
const NON_ADMIN_USERNAME = 'qa_e2e_menu_editor';
const NON_ADMIN_PASSWORD = 'qa-e2e-menu-editor-pw-1';

test.beforeAll( () => {
	ensurePluginActive();

	if ( wpCliSafe( `user get ${ NON_ADMIN_USERNAME } --field=ID` ) === null ) {
		wpCli(
			`user create ${ NON_ADMIN_USERNAME } ${ NON_ADMIN_USERNAME }@example.test ` +
				`--role=editor --user_pass=${ NON_ADMIN_PASSWORD }`
		);
	}
} );

test.describe( 'Admin menu registration', () => {
	test( 'AC-001: the beehiiv menu item appears in the admin sidebar for an administrator', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );

		const menuItem = page.locator( '#toplevel_page_beehiiv' );
		await expect( menuItem ).toBeVisible();
		await expect( menuItem.locator( '.wp-menu-name' ) ).toHaveText(
			'beehiiv'
		);
	} );

	test( 'AC-002: clicking the menu item navigates to the beehiiv Settings page', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );

		await page.locator( '#toplevel_page_beehiiv > a.menu-top' ).click();

		await expect( page ).toHaveURL(
			/\/wp-admin\/admin\.php\?page=beehiiv/
		);
		await expect( page.locator( 'h1' ) ).toHaveText( 'beehiiv Settings' );
	} );

	test( 'AC-003: the menu item displays an icon alongside the label', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );

		const iconBox = page.locator( '#toplevel_page_beehiiv .wp-menu-image' );
		await expect( iconBox ).toBeVisible();

		// Icon is a CSS mask on the ::before pseudo-element (admin.scss), not an
		// <img>, so assert on its computed box rather than an image src/alt.
		const beforeStyle = await iconBox.evaluate( ( el ) => {
			const style = window.getComputedStyle( el, '::before' );
			return {
				content: style.content,
				width: style.width,
				height: style.height,
			};
		} );

		expect( beforeStyle.content ).not.toBe( 'none' );
		expect( parseFloat( beforeStyle.width ) ).toBeGreaterThan( 0 );
		expect( parseFloat( beforeStyle.height ) ).toBeGreaterThan( 0 );
	} );

	test( 'AC-004: the menu item is hidden from, and the settings page blocked for, non-administrator users', async ( {
		page,
	} ) => {
		await loginAs( page, NON_ADMIN_USERNAME, NON_ADMIN_PASSWORD );
		await page.goto( '/wp-admin/' );

		await expect( page.locator( '#toplevel_page_beehiiv' ) ).toHaveCount(
			0
		);

		const response = await page.goto( '/wp-admin/admin.php?page=beehiiv' );
		expect( response.status() ).toBe( 403 );
		await expect( page.locator( 'body' ) ).toContainText(
			/not allowed to access this page/i
		);
	} );
} );
