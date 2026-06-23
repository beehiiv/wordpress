/**
 * Render a translated string that may contain an `<a>` placeholder as a settings link.
 */
import { createInterpolateElement } from '@wordpress/element';
import { ExternalLink } from '@wordpress/components';

/**
 * @param {string} message     Message text; use `<a>…</a>` for the settings link label.
 * @param {string} settingsUrl beehiiv plugin settings admin URL.
 * @return {import('react').ReactNode} Message with an optional external link.
 */
export default function renderSettingsLinkMessage( message, settingsUrl ) {
	if ( ! message || ! message.includes( '<a>' ) ) {
		return message;
	}

	return createInterpolateElement( message, {
		a: <ExternalLink href={ settingsUrl } />,
	} );
}
