/**
 * Connected beehiiv publications for the block editor, shared across components.
 *
 * Seeded from the localized editor config. A refresh replaces the list for every
 * component reading it (selector, notices, pre-publish panel).
 */
import { useSyncExternalStore } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import { useBeehiivEditorConfig } from './use-beehiiv-editor-config';

/** @type {Array<{id: string, name: string}>|null} */
let refreshedPublications = null;
const listeners = new Set();

/**
 * @param {() => void} listener Called when the list changes.
 * @return {() => void} Unsubscribe.
 */
function subscribe( listener ) {
	listeners.add( listener );

	return () => listeners.delete( listener );
}

function getSnapshot() {
	return refreshedPublications;
}

/**
 * Pull a fresh publication list from beehiiv, bypassing the server cache.
 *
 * An empty or failed response keeps the current list.
 *
 * @return {Promise<boolean>} Whether the list was refreshed.
 */
export async function refreshEditorPublications() {
	try {
		const items = await apiFetch( {
			path: '/beehiiv/v1/publications?refresh=1',
		} );
		const publications = Array.isArray( items )
			? items.filter( ( item ) => item?.id )
			: [];

		if ( publications.length === 0 ) {
			return false;
		}

		refreshedPublications = publications;
		listeners.forEach( ( listener ) => listener() );

		return true;
	} catch {
		return false;
	}
}

/**
 * @return {Array<{id: string, name: string}>} Connected publications.
 */
export function useEditorPublications() {
	const { publications } = useBeehiivEditorConfig();
	const refreshed = useSyncExternalStore( subscribe, getSnapshot );

	if ( refreshed ) {
		return refreshed;
	}

	return Array.isArray( publications ) ? publications : [];
}
