/* eslint-disable jsdoc/check-tag-names */
/**
 * @jest-environment jsdom
 */

const fs = require( 'fs' );
const path = require( 'path' );

// The boot script lives in PHP as a nowdoc so every gate prints the same code.
const php = fs.readFileSync(
	path.resolve( __dirname, '../../includes/Blocks/GatedContent.php' ),
	'utf8'
);
const BOOT_JS = php.match( /<<<'JS'\n([\s\S]*?)\nJS;/ )[ 1 ];

function run( cookie ) {
	document.cookie = 'beehiiv_gate_unlocked=; Max-Age=0; Path=/';

	if ( cookie ) {
		document.cookie = cookie;
	}

	document.body.innerHTML = `
		<div class="gate" data-cookie-name="beehiiv_gate_unlocked" data-form-id="form_1">
			<div class="card"></div>
		</div>`;

	const script = document.createElement( 'script' );
	script.textContent = BOOT_JS;
	document.querySelector( '.card' ).appendChild( script );
}

describe( 'gated content boot script', () => {
	it( 'is read from the PHP file', () => {
		expect( BOOT_JS ).toContain( 'document.currentScript' );
	} );

	it( 'adds the form loader for a locked reader', () => {
		run();
		const loader = document.querySelector(
			'.card script[data-beehiiv-form]'
		);

		expect( loader ).not.toBeNull();
		expect( loader.getAttribute( 'data-beehiiv-form' ) ).toBe( 'form_1' );
		expect( loader.src ).toBe(
			'https://subscribe-forms.beehiiv.com/v3/loader.js'
		);
		expect( document.querySelector( '.gate' ).classList ).not.toContain(
			'is-unlocked'
		);
	} );

	it( 'opens the gate and skips the loader when the cookie exists', () => {
		run( 'beehiiv_gate_unlocked=1; Path=/' );

		expect( document.querySelector( '.gate' ).classList ).toContain(
			'is-unlocked'
		);
		expect( document.querySelector( '.card' ).classList ).toContain(
			'is-hidden'
		);
		expect(
			document.querySelector( '.card script[data-beehiiv-form]' )
		).toBeNull();
	} );
} );
