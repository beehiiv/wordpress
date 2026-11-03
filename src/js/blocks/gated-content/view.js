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
const LOADER_SRC = 'https://subscribe-forms.beehiiv.com/v3/loader.js';

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

// The beehiiv loader puts the form next to its own script tag. It is added
// here, not in the page, so readers who are already unlocked never load it.
function loadForm( gate ) {
	const card = gate.querySelector( '.beehiiv-gated-content__card' );

	if ( ! card || ! gate.dataset.formId ) {
		return;
	}

	const script = document.createElement( 'script' );
	script.async = true;
	script.src = LOADER_SRC;
	script.dataset.beehiivForm = gate.dataset.formId;
	card.appendChild( script );
}

function init() {
	const gates = Array.from(
		document.querySelectorAll( '[data-beehiiv-gate]' )
	);

	// The unlock cookie is site-wide, so one cookie unlocks every gate.
	const unlocked = gates.some( ( gate ) =>
		hasCookie( gate.dataset.cookieName )
	);

	if ( unlocked ) {
		gates.forEach( ( gate ) => unlock( gate, true ) );
		return;
	}

	if ( ! gates.length ) {
		return;
	}

	gates.forEach( loadForm );

	window.addEventListener( 'message', ( event ) => {
		if (
			! ALLOWED_ORIGINS.includes( event.origin ) ||
			! event.data ||
			event.data.type !== SUBMITTED_TYPE
		) {
			return;
		}

		const source = gates.find(
			( gate ) =>
				gate.dataset.formId === String( event.data.externalEmbedId )
		);

		if ( ! source ) {
			return;
		}

		setCookie(
			source.dataset.cookieName,
			parseInt( source.dataset.cookieDays, 10 ) || 30
		);
		gates.forEach( ( gate ) => unlock( gate ) );
	} );
}

// Block themes can print this script in the head, before the gate exists.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
