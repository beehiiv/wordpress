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

const refreshDefaultLabel =
	refreshTemplatesButton?.textContent.trim() ||
	__( 'Refresh templates', 'beehiiv' );

let refreshNotice = null;
let refreshNoticeTimer = null;

/**
 * Show an auto-dismissing confirmation after a manual refresh.
 *
 * @return {void}
 */
function showRefreshNotice() {
	if ( ! refreshTemplatesButton ) {
		return;
	}

	if ( ! refreshNotice ) {
		refreshNotice = document.createElement( 'span' );
		refreshNotice.className = 'beehiiv-refresh-notice';
		refreshNotice.setAttribute( 'role', 'status' );
		refreshTemplatesButton.insertAdjacentElement(
			'afterend',
			refreshNotice
		);
	}

	refreshNotice.textContent = __(
		'Templates updated from beehiiv.',
		'beehiiv'
	);
	refreshNotice.hidden = false;

	if ( refreshNoticeTimer ) {
		clearTimeout( refreshNoticeTimer );
	}

	refreshNoticeTimer = setTimeout( () => {
		refreshNotice.hidden = true;
	}, 4000 );
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

	items.forEach( ( item ) => {
		if ( ! item?.id ) {
			return;
		}

		const option = document.createElement( 'option' );
		option.value = item.id;
		option.textContent = item.name || item.id;
		templateSelect.appendChild( option );
	} );
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

			if ( refreshNotice ) {
				refreshNotice.hidden = true;
			}
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
			showRefreshNotice();
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
