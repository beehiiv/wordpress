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
			<div class="beehiiv-gated-content__card"></div>
			<div class="beehiiv-gated-content__locked" aria-hidden="true" inert></div>
		</div>`;

	// The script sits at the end of the gate, after the locked content.
	const script = document.createElement( 'script' );
	script.textContent = BOOT_JS;
	document.querySelector( '.gate' ).appendChild( script );
}

describe( 'gated content boot script', () => {
	it( 'is read from the PHP file', () => {
		expect( BOOT_JS ).toContain( 'document.currentScript' );
	} );

	it( 'adds the form loader for a locked reader', () => {
		run();
		const loader = document.querySelector(
			'.beehiiv-gated-content__card script[data-beehiiv-form]'
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
		const locked = document.querySelector(
			'.beehiiv-gated-content__locked'
		);

		// The boot script also clears the attributes that hide the content.
		expect( locked.hasAttribute( 'aria-hidden' ) ).toBe( false );
		expect( locked.hasAttribute( 'inert' ) ).toBe( false );
		expect(
			document.querySelector(
				'.beehiiv-gated-content__card script[data-beehiiv-form]'
			)
		).toBeNull();
	} );
} );
