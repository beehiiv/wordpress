/**
 * Error notice shown when an Advertisement block has no advertisement selected.
 */
import { __ } from '@wordpress/i18n';

import PostSettingsNotice from './post-settings-notice';
import { useHasIncompleteAdvertisement } from '../hooks/use-incomplete-advertisement';

/**
 * @param {Object}  props
 * @param {boolean} [props.suppressed] Skip the notice when a server-side send error is already shown.
 * @return {import('react').JSX.Element|null} Error notice or null.
 */
export default function IncompleteAdvertisementNotice( {
	suppressed = false,
} ) {
	const hasIncompleteAd = useHasIncompleteAdvertisement();

	if ( suppressed || ! hasIncompleteAd ) {
		return null;
	}

	return (
		<PostSettingsNotice status="error">
			{ __(
				'Select an advertisement for the Advertisement block, or remove the block, to send this newsletter.',
				'beehiiv'
			) }
		</PostSettingsNotice>
	);
}
