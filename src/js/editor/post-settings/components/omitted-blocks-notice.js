/**
 * Omitted-block message for the beehiiv sidebar send notice.
 */
import { _n, sprintf } from '@wordpress/i18n';

import PostSettingsNotice from './post-settings-notice';
import { useOmittedBlockCount } from '../hooks/use-omitted-blocks';

/**
 * @return {import('react').JSX.Element|null} Omitted blocks message or null.
 */
export function OmittedBlocksNoticeMessage() {
	const omittedBlockCount = useOmittedBlockCount();

	if ( omittedBlockCount < 1 ) {
		return null;
	}

	return (
		<p className="beehiiv-post-settings-notice__omitted">
			<span
				className="beehiiv-post-settings-notice__omitted-icon dashicons dashicons-hidden"
				aria-hidden="true"
			/>

			{ sprintf(
				/* translators: %d: number of omitted blocks. */
				_n(
					'%d block will be omitted from this newsletter.',
					'%d blocks will be omitted from this newsletter.',
					omittedBlockCount,
					'beehiiv'
				),
				omittedBlockCount
			) }
		</p>
	);
}

/**
 * Standalone warning for a linked post whose newsletter is still scheduled.
 *
 * A linked post has no send warning to hold the message, so it gets its own
 * notice, shown only when a block will be omitted.
 *
 * @return {import('react').JSX.Element|null} Warning notice or null.
 */
export function OmittedBlocksNotice() {
	const omittedBlockCount = useOmittedBlockCount();

	if ( omittedBlockCount < 1 ) {
		return null;
	}

	return (
		<PostSettingsNotice status="warning">
			<OmittedBlocksNoticeMessage />
		</PostSettingsNotice>
	);
}
