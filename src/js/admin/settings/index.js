/**
 * Beehiiv wp-admin settings screen.
 */
import './settings.scss';

import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

const publicationSelect = document.getElementById( 'beehiiv_publication_id' );
const templateSelect = document.getElementById( 'beehiiv_post_template_id' );

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
 * @param {string} publicationId Publication ID.
 *
 * @return {Promise<void>}
 */
async function loadTemplates( publicationId ) {
	if ( ! templateSelect ) {
		return;
	}

	if ( ! publicationId ) {
		populateTemplateOptions( [] );
		return;
	}

	templateSelect.disabled = true;

	try {
		const items = await apiFetch( {
			path: `/beehiiv/v1/post-templates?publication_id=${ encodeURIComponent(
				publicationId
			) }`,
		} );

		populateTemplateOptions( Array.isArray( items ) ? items : [] );
	} catch {
		populateTemplateOptions( [] );
	} finally {
		templateSelect.disabled = false;
	}
}

if ( publicationSelect && templateSelect ) {
	publicationSelect.addEventListener( 'change', ( event ) => {
		const publicationId = event.target.value;
		loadTemplates( publicationId );
	} );
}
