const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { wpCli, wpCliSafe, ensurePluginActive } = require( '../utils/wp-cli' );

/**
 * PRD: requirements/08-admin-interface/1-settings-page/subscriber-gate-defaults.prd.md
 * (PRD-08.1.03 Subscriber Gate Defaults)
 *
 * Covers the two criteria the server tests cannot show through the real page:
 * - AC-002: the Subscriber gating section shows when beehiiv is disconnected.
 * - AC-012: saving the Publication and Template settings leaves the gating
 *   defaults alone, and saving the gating defaults leaves the publication
 *   and template alone.
 *
 * State is arranged with the test-only seams in
 * tests/e2e/plugins/beehiiv-options.php. Every save goes through the real
 * settings form and its real submit button.
 */

const SETTINGS_PATH = '/wp-admin/admin.php?page=beehiiv';
const OPTION = 'beehiiv_settings';
const PUB_A = { id: 'pub_gate_alpha', name: 'Alpha Daily' };
const PUB_B = { id: 'pub_gate_beta', name: 'Beta Weekly' };
const TEMPLATES = {
	[ PUB_A.id ]: [ { id: 'tpl_a1', name: 'Alpha Standard' } ],
	[ PUB_B.id ]: [ { id: 'tpl_b1', name: 'Beta Classic' } ],
};

const b64 = ( value ) =>
	Buffer.from( JSON.stringify( value ) ).toString( 'base64' );
const json = ( value ) =>
	`json_decode( base64_decode( "${ b64( value ) }" ), true )`;

function readOption() {
	const raw = wpCliSafe( `option get ${ OPTION } --format=json` );
	return raw ? JSON.parse( raw ) : null;
}

function writeOption( value ) {
	wpCli(
		`option update ${ OPTION } '${ JSON.stringify( value ) }' --format=json`
	);
}

function seedConnected() {
	wpCli(
		`eval 'beehiiv_e2e_seed_connection(); beehiiv_e2e_mock_permissions( [ "posts" => [ "read", "write" ] ] ); beehiiv_e2e_seed_publications( ${ json(
			[ PUB_A, PUB_B ]
		) } );'`
	);

	for ( const [ pub, templates ] of Object.entries( TEMPLATES ) ) {
		wpCli(
			`eval 'beehiiv_e2e_seed_post_templates( "${ pub }", ${ json(
				templates
			) } );'`
		);
	}
}

test.beforeAll( () => {
	ensurePluginActive();
} );

test.describe( 'Subscriber gate defaults on the settings page', () => {
	test.beforeEach( async ( { page } ) => {
		wpCli(
			`eval 'beehiiv_e2e_reset_all(); delete_option( "${ OPTION }" );'`
		);
		await loginAsAdmin( page );
	} );

	test.afterEach( () => {
		wpCli(
			`eval 'beehiiv_e2e_reset_all(); delete_option( "${ OPTION }" );'`
		);
	} );

	test( 'AC-002: the Subscriber gating section shows and saves when beehiiv is disconnected', async ( {
		page,
	} ) => {
		await page.goto( SETTINGS_PATH );

		await expect(
			page.getByRole( 'heading', { name: 'Subscriber gating' } )
		).toBeVisible();
		// No connection, so the Publication section is not offered.
		await expect( page.locator( '#beehiiv_publication_id' ) ).toHaveCount(
			0
		);

		await page
			.locator( '#beehiiv_gate_form_id' )
			.fill( 'form_disconnected' );
		await page.locator( '#beehiiv_gate_cookie_days' ).fill( '14' );
		await page.locator( '#submit' ).click();
		await page.waitForURL( /page=beehiiv/ );

		await expect( page.locator( '#beehiiv_gate_form_id' ) ).toHaveValue(
			'form_disconnected'
		);
		expect( readOption() ).toMatchObject( {
			gate_form_id: 'form_disconnected',
			gate_cookie_days: '14',
		} );
	} );

	test( 'AC-012: saving the publication and template keeps the gating defaults', async ( {
		page,
	} ) => {
		seedConnected();
		writeOption( {
			publication_id: PUB_A.id,
			post_template_id: 'tpl_a1',
			gate_headline: 'Join the list',
			gate_text: 'Sign up free.',
			gate_form_id: 'form_keep',
			gate_cookie_days: '21',
		} );
		await page.goto( SETTINGS_PATH );

		await page
			.locator( '#beehiiv_publication_id' )
			.selectOption( PUB_B.id );
		await page
			.locator( '#beehiiv_post_template_id' )
			.selectOption( 'tpl_b1' );
		await page.locator( '#submit' ).click();
		await page.waitForURL( /page=beehiiv/ );

		expect( readOption() ).toMatchObject( {
			publication_id: PUB_B.id,
			post_template_id: 'tpl_b1',
			gate_headline: 'Join the list',
			gate_text: 'Sign up free.',
			gate_form_id: 'form_keep',
			gate_cookie_days: '21',
		} );
	} );

	test( 'AC-012: saving the gating defaults keeps the publication and template', async ( {
		page,
	} ) => {
		seedConnected();
		writeOption( {
			publication_id: PUB_A.id,
			post_template_id: 'tpl_a1',
		} );
		await page.goto( SETTINGS_PATH );

		await page.locator( '#beehiiv_gate_form_id' ).fill( 'form_new' );
		await page
			.locator( '#beehiiv_gate_headline' )
			.fill( 'Subscribe to read' );
		await page.locator( '#submit' ).click();
		await page.waitForURL( /page=beehiiv/ );

		expect( readOption() ).toMatchObject( {
			publication_id: PUB_A.id,
			post_template_id: 'tpl_a1',
			gate_form_id: 'form_new',
			gate_headline: 'Subscribe to read',
		} );
		await expect( page.locator( '#beehiiv_publication_id' ) ).toHaveValue(
			PUB_A.id
		);
	} );
} );
