/**
 * Front-end behavior for the beehiiv Gated Content block.
 *
 * Unlocks every gate on the page when one of the gates' beehiiv forms is
 * submitted, and removes the gates when the unlock cookie is already present.
 */
const ALLOWED_ORIGINS = [
	'https://subscribe-forms.beehiiv.com',
	'https://embeds.beehiiv.com',
];
const SUBMITTED_TYPE = 'BEEHIIV_SUBSCRIBER_FORM_SUBMITTED';

function hasCookie( name ) {
	return document.cookie
		.split( '; ' )
		.some( ( part ) => part.split( '=' )[ 0 ] === name );
}

function setCookie( name, days ) {
	const maxAge = days * 24 * 60 * 60;
	const secure = window.location.protocol === 'https:' ? '; Secure' : '';
	document.cookie = `${ name }=1; Max-Age=${ maxAge }; Path=/; SameSite=Lax${ secure }`;
}

function unlock( gate, immediate = false ) {
	const locked = gate.querySelector( '.beehiiv-gated-content__locked' );
	const card = gate.querySelector( '.beehiiv-gated-content__card' );

	gate.classList.add( 'is-unlocked' );

	if ( locked ) {
		locked.removeAttribute( 'aria-hidden' );
		locked.removeAttribute( 'inert' );
	}

	if ( card && immediate ) {
		// Returning reader: remove the card now so the gate does not linger.
		card.classList.add( 'is-hidden' );
	} else if ( card ) {
		window.setTimeout( () => card.classList.add( 'is-hidden' ), 300 );
	}
}

function init() {
	const gates = Array.from(
		document.querySelectorAll( '[data-beehiiv-gate]' )
	);

	if ( ! gates.length ) {
		return;
	}

	// The cookie is site-wide, so every gate shares the same name and lifetime.
	const cookieName = gates[ 0 ].dataset.cookieName;
	if ( hasCookie( cookieName ) ) {
		gates.forEach( ( gate ) => unlock( gate, true ) );
		return;
	}

	const cookieDays = parseInt( gates[ 0 ].dataset.cookieDays, 10 ) || 30;
	const formIds = gates.map( ( gate ) => gate.dataset.formId );

	window.addEventListener( 'message', ( event ) => {
		if (
			! ALLOWED_ORIGINS.includes( event.origin ) ||
			! event.data ||
			event.data.type !== SUBMITTED_TYPE ||
			! formIds.includes( String( event.data.externalEmbedId ) )
		) {
			return;
		}

		setCookie( cookieName, cookieDays );
		gates.forEach( ( gate ) => unlock( gate ) );
	} );
}

// Block themes can print this script in the head, before the gate exists.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
