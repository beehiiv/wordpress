const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin, loginAs } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/2-admin-menu/menu-registration.prd.md
 *
 * Fixture users, created idempotently (reused across repeated runs against
 * this shared wp-env tests environment):
 * - Editor: can publish posts, no `manage_options`.
 * - Author: can publish posts, no `manage_options`.
 * - Contributor: cannot publish posts.
 */
const USERS = {
	editor: { name: 'qa_e2e_menu_editor', role: 'editor' },
	author: { name: 'qa_e2e_menu_author', role: 'author' },
	contributor: { name: 'qa_e2e_menu_contributor', role: 'contributor' },
};
const PASSWORD = 'qa-e2e-menu-user-pw-1';

test.beforeAll( () => {
	ensurePluginActive();

	Object.values( USERS ).forEach( ( { name, role } ) => {
		if ( wpCliSafe( `user get ${ name } --field=ID` ) === null ) {
			wpCli(
				`user create ${ name } ${ name }@example.test ` +
					`--role=${ role } --user_pass=${ PASSWORD }`
			);
		} else {
			// Reused user from an earlier run: pin the known password.
			wpCli( `user update ${ name } --user_pass=${ PASSWORD }` );
		}
	} );
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

	test( 'AC-004: the beehiiv Settings page is reachable by administrators only', async ( {
		page,
		browser,
	} ) => {
		// Administrator reaches the page.
		await loginAsAdmin( page );
		const adminResponse = await page.goto(
			'/wp-admin/admin.php?page=beehiiv'
		);
		expect( adminResponse.status() ).toBe( 200 );
		await expect( page.locator( 'h1' ) ).toHaveText( 'beehiiv Settings' );

		// Every non-administrator is blocked, including users who can
		// publish posts (they see the beehiiv menu, but not Settings).
		for ( const { name } of Object.values( USERS ) ) {
			const context = await browser.newContext();
			const userPage = await context.newPage();
			await loginAs( userPage, name, PASSWORD );

			const response = await userPage.goto(
				'/wp-admin/admin.php?page=beehiiv'
			);
			expect( response.status(), `${ name } status` ).toBe( 403 );
			await expect( userPage.locator( 'body' ) ).toContainText(
				/not allowed to access this page/i
			);
			await expect(
				userPage.locator( 'h1', { hasText: 'beehiiv Settings' } )
			).toHaveCount( 0 );

			await userPage.goto( '/wp-admin/' );
			await expect(
				userPage.locator(
					'#toplevel_page_beehiiv .wp-submenu a:text-is("Settings")'
				)
			).toHaveCount( 0 );

			await context.close();
		}
	} );

	test( 'AC-005: users who can publish posts see a Newsletters entry under the beehiiv menu', async ( {
		browser,
	} ) => {
		for ( const { name } of [ USERS.editor, USERS.author ] ) {
			const context = await browser.newContext();
			const userPage = await context.newPage();
			await loginAs( userPage, name, PASSWORD );
			await userPage.goto( '/wp-admin/' );

			const menu = userPage.locator( '#toplevel_page_beehiiv' );
			await expect( menu, `${ name } sees beehiiv menu` ).toBeVisible();
			await expect(
				menu.locator( '.wp-submenu a', { hasText: 'Newsletters' } ),
				`${ name } sees Newsletters entry`
			).toBeVisible();

			await context.close();
		}
	} );
} );
