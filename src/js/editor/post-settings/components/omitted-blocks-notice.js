/**
 * Omitted-block message for the beehiiv sidebar send notice.
 */
import { _n, sprintf } from '@wordpress/i18n';

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
