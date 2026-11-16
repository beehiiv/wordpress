/**
 * Front-end behavior for the beehiiv Gated Content block.
 *
 * Unlocks every gate on the page when one of the gates' beehiiv forms is
 * submitted, and removes the gates when the unlock cookie is already present.
 * The server prints a small inline script in each card that opens the gate
 * for returning readers before the first paint and starts the form loader.
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

// Tell assistive technology the content is open, and move focus to it. The card
// that held focus is about to disappear.
function announce( gate, locked ) {
	const message = gate.dataset.unlockedMessage;

	if ( message ) {
		const status = document.createElement( 'p' );
		status.className = 'beehiiv-gated-content__status';
		status.setAttribute( 'role', 'status' );
		gate.appendChild( status );
		// Set the text after the node is in the page so the change is announced.
		window.setTimeout( () => {
			status.textContent = message;
		}, 50 );
	}

	if ( locked ) {
		locked.setAttribute( 'tabindex', '-1' );
		locked.focus( { preventScroll: true } );
	}
}

// The card fade and removal are CSS only, driven by the is-unlocked class.
function unlock( gate, announceUnlock = false ) {
	const locked = gate.querySelector( '.beehiiv-gated-content__locked' );

	gate.classList.add( 'is-unlocked' );

	if ( locked ) {
		locked.removeAttribute( 'aria-hidden' );
		locked.removeAttribute( 'inert' );
	}

	if ( announceUnlock ) {
		announce( gate, locked );
	}
}

function init() {
	const gates = Array.from(
		document.querySelectorAll( '[data-beehiiv-gate]' )
	);

	// The unlock cookie is site-wide, so one cookie unlocks every gate. The
	// inline boot script already did this; this covers pages where it was blocked.
	const unlocked = gates.some( ( gate ) =>
		hasCookie( gate.dataset.cookieName )
	);

	if ( unlocked ) {
		gates.forEach( ( gate ) => unlock( gate ) );
		return;
	}

	if ( ! gates.length ) {
		return;
	}

	const onMessage = ( event ) => {
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

		// Unlock once. Only the gate that was submitted takes focus and announces.
		window.removeEventListener( 'message', onMessage );
		gates.forEach( ( gate ) => unlock( gate, gate === source ) );
	};

	window.addEventListener( 'message', onMessage );
}

// Block themes can print this script in the head, before the gate exists.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
