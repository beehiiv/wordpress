/* eslint-disable jsdoc/check-tag-names */
/**
 * @jest-environment jsdom
 */

const GATE_HTML = `
	<div class="wp-block-beehiiv-gated-content">
		<div class="beehiiv-gated-content__gate" data-beehiiv-gate data-form-id="form_1" data-cookie-name="beehiiv_gate_unlocked" data-cookie-days="14">
			<div class="beehiiv-gated-content__card"></div>
			<div class="beehiiv-gated-content__locked" aria-hidden="true" inert></div>
		</div>
	</div>`;

function load() {
	jest.resetModules();
	require( '../../src/js/blocks/gated-content/view.js' );
}

function post( data, origin = 'https://subscribe-forms.beehiiv.com' ) {
	window.dispatchEvent( new MessageEvent( 'message', { data, origin } ) );
}

const gate = () => document.querySelector( '[data-beehiiv-gate]' );
const locked = () => document.querySelector( '.beehiiv-gated-content__locked' );

describe( 'gated content view', () => {
	beforeEach( () => {
		document.body.innerHTML = GATE_HTML;
		document.cookie = 'beehiiv_gate_unlocked=; Max-Age=0; Path=/';
	} );

	it( 'unlocks and sets the cookie when the matching form is submitted', () => {
		load();
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_1',
		} );

		expect( gate().classList.contains( 'is-unlocked' ) ).toBe( true );
		expect( locked().hasAttribute( 'aria-hidden' ) ).toBe( false );
		expect( locked().hasAttribute( 'inert' ) ).toBe( false );
		expect( document.cookie ).toContain( 'beehiiv_gate_unlocked=1' );
	} );

	it( 'unlocks every gate when any gate form is submitted', () => {
		document.body.innerHTML =
			GATE_HTML + GATE_HTML.replace( 'form_1', 'form_2' );
		load();
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_2',
		} );

		const gates = document.querySelectorAll( '[data-beehiiv-gate]' );
		expect( gates ).toHaveLength( 2 );
		gates.forEach( ( g ) =>
			expect( g.classList.contains( 'is-unlocked' ) ).toBe( true )
		);
	} );

	it( 'moves focus to the content and announces the unlock', () => {
		jest.useFakeTimers();
		document.querySelector(
			'[data-beehiiv-gate]'
		).dataset.unlockedMessage = 'Content unlocked.';
		load();
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_1',
		} );
		jest.advanceTimersByTime( 100 );

		expect( document.activeElement ).toBe( locked() );
		expect( document.querySelector( '[role="status"]' ).textContent ).toBe(
			'Content unlocked.'
		);
		jest.useRealTimers();
	} );

	it( 'does not announce for a returning reader', () => {
		document.cookie = 'beehiiv_gate_unlocked=1; Path=/';
		load();

		expect( document.querySelector( '[role="status"]' ) ).toBeNull();
	} );

	it( 'accepts the legacy embed origin', () => {
		load();
		post(
			{
				type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
				externalEmbedId: 'form_1',
			},
			'https://embeds.beehiiv.com'
		);

		expect( gate().classList.contains( 'is-unlocked' ) ).toBe( true );
	} );

	it( 'stays locked for a different form, origin or message type', () => {
		load();
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'other',
		} );
		post(
			{
				type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
				externalEmbedId: 'form_1',
			},
			'https://evil.example'
		);
		post( { type: 'SOMETHING_ELSE', externalEmbedId: 'form_1' } );

		expect( gate().classList.contains( 'is-unlocked' ) ).toBe( false );
		expect( locked().hasAttribute( 'inert' ) ).toBe( true );
		expect( document.cookie ).not.toContain( 'beehiiv_gate_unlocked' );
	} );

	it( 'removes the gate when the unlock cookie already exists', () => {
		document.cookie = 'beehiiv_gate_unlocked=1; Path=/';
		load();

		expect( gate().classList.contains( 'is-unlocked' ) ).toBe( true );
		expect( locked().hasAttribute( 'aria-hidden' ) ).toBe( false );
	} );

	it( 'unlocks once: a repeat message does not announce or refocus again', () => {
		jest.useFakeTimers();
		gate().dataset.unlockedMessage = 'Content unlocked.';
		load();
		const msg = {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_1',
		};
		post( msg );
		post( msg );
		jest.advanceTimersByTime( 100 );

		expect( document.querySelectorAll( '[role="status"]' ) ).toHaveLength(
			1
		);
		jest.useRealTimers();
	} );

	it( 'moves focus and announces only for the gate that was submitted', () => {
		jest.useFakeTimers();
		document.body.innerHTML =
			GATE_HTML +
			GATE_HTML.replace( 'form_1', 'form_2' ).replace(
				'<div class="beehiiv-gated-content__gate"',
				'<div class="beehiiv-gated-content__gate" data-second'
			);
		document.querySelectorAll( '[data-beehiiv-gate]' ).forEach( ( g ) => {
			g.dataset.unlockedMessage = 'Content unlocked.';
		} );
		load();
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_1',
		} );
		jest.advanceTimersByTime( 100 );

		const [ first ] = document.querySelectorAll( '[data-beehiiv-gate]' );
		expect( document.querySelectorAll( '[role="status"]' ) ).toHaveLength(
			1
		);
		expect( document.activeElement ).toBe(
			first.querySelector( '.beehiiv-gated-content__locked' )
		);
		jest.useRealTimers();
	} );

	it( 'still works when the script runs before the gate is in the page', () => {
		document.body.innerHTML = '';
		Object.defineProperty( document, 'readyState', {
			configurable: true,
			get: () => 'loading',
		} );
		load();

		document.body.innerHTML = GATE_HTML;
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		post( {
			type: 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED',
			externalEmbedId: 'form_1',
		} );
		delete document.readyState;

		expect( gate().classList.contains( 'is-unlocked' ) ).toBe( true );
	} );
} );
