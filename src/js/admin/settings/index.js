/**
 * beehiiv wp-admin settings screen.
 */
import './settings.scss';

import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

const publicationSelect = document.getElementById( 'beehiiv_publication_id' );
const templateSelect = document.getElementById( 'beehiiv_post_template_id' );
const refreshTemplatesButton = document.getElementById(
	'beehiiv_refresh_post_templates'
);

const refreshPublicationsButton = document.getElementById(
	'beehiiv_refresh_publications'
);

const refreshDefaultLabel =
	refreshTemplatesButton?.textContent.trim() ||
	__( 'Refresh templates', 'beehiiv' );

const refreshPublicationsDefaultLabel =
	refreshPublicationsButton?.textContent.trim() ||
	__( 'Refresh publications', 'beehiiv' );

/**
 * Confirmation notice element and its dismiss timer, per refresh button.
 *
 * @type {Map<HTMLElement, {element: HTMLElement, timer: number|null}>}
 */
const refreshNotices = new Map();

/**
 * Show or hide the "no templates available" notice for the current publication.
 *
 * @param {boolean} hasTemplates Whether the publication has any templates.
 *
 * @return {void}
 */
function updateNoTemplatesNotice( hasTemplates ) {
	if ( ! refreshTemplatesButton ) {
		return;
	}

	let notice = document.querySelector( '.beehiiv-no-templates-notice' );
	const shouldShow = !! publicationSelect?.value && ! hasTemplates;

	if ( ! shouldShow ) {
		if ( notice ) {
			notice.hidden = true;
		}
		return;
	}

	if ( ! notice ) {
		notice = document.createElement( 'p' );
		notice.className = 'description beehiiv-no-templates-notice';
		notice.textContent = __(
			'This publication has no post templates. Create a template in beehiiv, then refresh.',
			'beehiiv'
		);
		refreshTemplatesButton.insertAdjacentElement( 'afterend', notice );
	}

	notice.hidden = false;
}

/**
 * Show an auto-dismissing confirmation next to a refresh button.
 *
 * @param {HTMLElement|null} button  Refresh button the notice follows.
 * @param {string}           message Confirmation text.
 *
 * @return {void}
 */
function showRefreshNotice( button, message ) {
	if ( ! button ) {
		return;
	}

	let state = refreshNotices.get( button );

	if ( ! state ) {
		const element = document.createElement( 'span' );
		element.className = 'beehiiv-refresh-notice';
		element.setAttribute( 'role', 'status' );
		button.insertAdjacentElement( 'afterend', element );
		state = { element, timer: null };
		refreshNotices.set( button, state );
	}

	state.element.textContent = message;
	state.element.hidden = false;

	if ( state.timer ) {
		clearTimeout( state.timer );
	}

	state.timer = setTimeout( () => {
		state.element.hidden = true;
	}, 4000 );
}

/**
 * Hide a refresh button's confirmation notice, if shown.
 *
 * @param {HTMLElement|null} button Refresh button.
 *
 * @return {void}
 */
function hideRefreshNotice( button ) {
	const state = button ? refreshNotices.get( button ) : null;

	if ( state ) {
		state.element.hidden = true;
	}
}

/**
 * Build option elements for the template dropdown.
 *
 * @param {Array<{id: string, name: string}>} items Template items.
 *
 * @return {void}
 */
function populateTemplateOptions( items ) {
	if ( ! templateSelect ) {
		return;
	}

	while ( templateSelect.options.length > 0 ) {
		templateSelect.remove( 0 );
	}

	const emptyOption = document.createElement( 'option' );
	emptyOption.value = '';
	emptyOption.textContent = __( 'No default template', 'beehiiv' );
	templateSelect.appendChild( emptyOption );

	let hasTemplates = false;

	items.forEach( ( item ) => {
		if ( ! item?.id ) {
			return;
		}

		hasTemplates = true;

		const option = document.createElement( 'option' );
		option.value = item.id;
		option.textContent = item.name || item.id;
		templateSelect.appendChild( option );
	} );

	updateNoTemplatesNotice( hasTemplates );
}

/**
 * Fetch templates for the selected publication via REST API.
 *
 * @param {string}  publicationId   Publication ID.
 * @param {boolean} [refresh=false] Bypass the server cache and pull a fresh list.
 *
 * @return {Promise<void>}
 */
async function loadTemplates( publicationId, refresh = false ) {
	if ( ! templateSelect ) {
		return;
	}

	if ( ! publicationId ) {
		populateTemplateOptions( [] );
		return;
	}

	// Keep the current selection across a refresh so the saved value is not lost.
	const previousValue = refresh ? templateSelect.value : '';

	templateSelect.disabled = true;

	if ( refreshTemplatesButton ) {
		refreshTemplatesButton.disabled = true;

		if ( refresh ) {
			refreshTemplatesButton.textContent = __( 'Refreshing…', 'beehiiv' );

			hideRefreshNotice( refreshTemplatesButton );
		}
	}

	try {
		const path = `/beehiiv/v1/post-templates?publication_id=${ encodeURIComponent(
			publicationId
		) }${ refresh ? '&refresh=1' : '' }`;

		const items = await apiFetch( { path } );

		populateTemplateOptions( Array.isArray( items ) ? items : [] );

		if (
			previousValue &&
			[ ...templateSelect.options ].some(
				( option ) => option.value === previousValue
			)
		) {
			templateSelect.value = previousValue;
		}

		if ( refresh ) {
			showRefreshNotice(
				refreshTemplatesButton,
				__( 'Templates updated from beehiiv.', 'beehiiv' )
			);
		}
	} catch {
		populateTemplateOptions( [] );
	} finally {
		templateSelect.disabled = false;

		if ( refreshTemplatesButton ) {
			refreshTemplatesButton.disabled = ! publicationSelect?.value;
			refreshTemplatesButton.textContent = refreshDefaultLabel;
		}
	}
}

if ( publicationSelect && templateSelect ) {
	publicationSelect.addEventListener( 'change', ( event ) => {
		const publicationId = event.target.value;
		loadTemplates( publicationId );
	} );
}

if ( refreshTemplatesButton ) {
	refreshTemplatesButton.addEventListener( 'click', () => {
		loadTemplates( publicationSelect?.value, true );
	} );
}

/**
 * Rebuild the publication dropdown, keeping the selected publication.
 *
 * A selected publication that beehiiv no longer returns stays listed by ID,
 * as it is when the page first renders.
 *
 * @param {Array<{id: string, name: string}>} items    Publication items.
 * @param {string}                            selected Publication ID to keep selected.
 *
 * @return {void}
 */
function populatePublicationOptions( items, selected ) {
	while ( publicationSelect.options.length > 0 ) {
		publicationSelect.remove( 0 );
	}

	const emptyOption = document.createElement( 'option' );
	emptyOption.value = '';
	emptyOption.textContent = __( 'Select a publication', 'beehiiv' );
	publicationSelect.appendChild( emptyOption );

	items.forEach( ( item ) => {
		if ( ! item?.id ) {
			return;
		}

		const option = document.createElement( 'option' );
		option.value = item.id;
		option.textContent = item.name || item.id;
		publicationSelect.appendChild( option );
	} );

	if (
		selected &&
		! [ ...publicationSelect.options ].some(
			( option ) => option.value === selected
		)
	) {
		const option = document.createElement( 'option' );
		option.value = selected;
		option.textContent = selected;
		publicationSelect.appendChild( option );
	}

	publicationSelect.value = selected;
}

/**
 * Pull a fresh publication list from beehiiv, bypassing the server cache.
 *
 * @return {Promise<void>}
 */
async function refreshPublications() {
	if ( ! publicationSelect || ! refreshPublicationsButton ) {
		return;
	}

	const previousValue = publicationSelect.value;

	publicationSelect.disabled = true;
	refreshPublicationsButton.disabled = true;
	refreshPublicationsButton.textContent = __( 'Refreshing…', 'beehiiv' );
	hideRefreshNotice( refreshPublicationsButton );

	try {
		const items = await apiFetch( {
			path: '/beehiiv/v1/publications?refresh=1',
		} );

		populatePublicationOptions(
			Array.isArray( items ) ? items : [],
			previousValue
		);
		showRefreshNotice(
			refreshPublicationsButton,
			__( 'Publications updated from beehiiv.', 'beehiiv' )
		);
	} catch {
		// Keep the current list when beehiiv cannot be reached.
	} finally {
		publicationSelect.disabled = false;
		refreshPublicationsButton.disabled = false;
		refreshPublicationsButton.textContent = refreshPublicationsDefaultLabel;
	}
}

if ( refreshPublicationsButton ) {
	refreshPublicationsButton.addEventListener( 'click', refreshPublications );
}
