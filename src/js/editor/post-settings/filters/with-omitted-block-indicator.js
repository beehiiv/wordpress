/**
 * Visual indicators for blocks omitted from beehiiv newsletters.
 */
import { __ } from '@wordpress/i18n';
import { createHigherOrderComponent } from '@wordpress/compose';
import { addFilter } from '@wordpress/hooks';

import { useBeehiivPostMeta } from '../hooks/use-beehiiv-post-meta';
import { useIsOmittedBlock } from '../hooks/use-omitted-blocks';

// Custom hook to determine if a block should show an omitted block indicator.
function useShowOmittedBlockIndicators( clientId ) {
	const beehiivMeta = useBeehiivPostMeta();
	const isOmittedBlock = useIsOmittedBlock( clientId );

	return (
		!! beehiivMeta?.sendToNewsletter &&
		! beehiivMeta.newsletterAlreadySent &&
		isOmittedBlock
	);
}

// Higher order component to add a visual indicator to blocks that are omitted from the newsletter.
const withOmittedBlockIndicator = createHigherOrderComponent( ( BlockEdit ) => {
	return function BeehiivOmittedBlockEdit( props ) {
		const showIndicator = useShowOmittedBlockIndicators( props.clientId );

		if ( ! showIndicator ) {
			return <BlockEdit { ...props } />;
		}

		return (
			<div className="beehiiv-omitted-block">
				<BlockEdit { ...props } />

				<span
					className="beehiiv-omitted-block__icon dashicons dashicons-hidden"
					title={ __(
						'Not included in beehiiv newsletter',
						'beehiiv'
					) }
					aria-label={ __(
						'Not included in beehiiv newsletter',
						'beehiiv'
					) }
				/>
			</div>
		);
	};
}, 'withOmittedBlockIndicator' );

addFilter(
	'editor.BlockEdit',
	'beehiiv/omitted-block-indicator',
	withOmittedBlockIndicator
);
