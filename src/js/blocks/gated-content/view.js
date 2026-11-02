/**
 * Front-end behavior for the beehiiv Gated Content block.
 *
 * Unlocks the first gate on the page when its own beehiiv form is submitted,
 * and removes the gate when the unlock cookie is already present.
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
	// Only the first gate on a page counts.
	const gate = document.querySelector( '[data-beehiiv-gate]' );

	if ( ! gate ) {
		return;
	}

	const cookieName = gate.dataset.cookieName;
	const cookieDays = parseInt( gate.dataset.cookieDays, 10 ) || 30;
	const formId = gate.dataset.formId;

	if ( hasCookie( cookieName ) ) {
		unlock( gate, true );
		return;
	}

	window.addEventListener( 'message', ( event ) => {
		if (
			! ALLOWED_ORIGINS.includes( event.origin ) ||
			! event.data ||
			event.data.type !== SUBMITTED_TYPE ||
			String( event.data.externalEmbedId ) !== formId
		) {
			return;
		}

		setCookie( cookieName, cookieDays );
		unlock( gate );
	} );
}

// Block themes can print this script in the head, before the gate exists.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
