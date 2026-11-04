/**
 * Visual indicators for blocks omitted from beehiiv newsletters.
 */
import { __ } from '@wordpress/i18n';
import { createHigherOrderComponent } from '@wordpress/compose';
import { addFilter } from '@wordpress/hooks';

import { useBeehiivPostMeta } from '../hooks/use-beehiiv-post-meta';
import { useIsBeehiivSidebarOpen } from '../hooks/use-is-sidebar-open';
import { useIsOmittedBlock } from '../hooks/use-omitted-blocks';

// Custom hook to determine if a block should show an omitted block indicator.
function useShowOmittedBlockIndicators( clientId ) {
	const beehiivMeta = useBeehiivPostMeta();
	const isOmittedBlock = useIsOmittedBlock( clientId );
	const isSidebarOpen = useIsBeehiivSidebarOpen();

	// A linked newsletter that is still scheduled keeps syncing edits, so its
	// omitted blocks are marked too. A sent newsletter no longer changes.
	const isQueued =
		!! beehiivMeta?.sendToNewsletter && ! beehiivMeta.newsletterAlreadySent;
	const isScheduled =
		!! beehiivMeta?.newsletterAlreadySent &&
		! beehiivMeta.newsletterPublished;

	// The marks only show while the beehiiv sidebar is open.
	return isSidebarOpen && ( isQueued || isScheduled ) && isOmittedBlock;
}

// Higher order component that marks blocks omitted from the newsletter. It adds a class and a
// tooltip to the block's own wrapper element instead of wrapping the block in another element,
// so the block markup and its layout stay as they are.
const withOmittedBlockIndicator = createHigherOrderComponent(
	( BlockListBlock ) => {
		return function BeehiivOmittedBlockListBlock( props ) {
			const showIndicator = useShowOmittedBlockIndicators(
				props.clientId
			);

			if ( ! showIndicator ) {
				return <BlockListBlock { ...props } />;
			}

			return (
				<BlockListBlock
					{ ...props }
					className={ [ props.className, 'beehiiv-omitted-block' ]
						.filter( Boolean )
						.join( ' ' ) }
					wrapperProps={ {
						...props.wrapperProps,
						title: __(
							'Not included in beehiiv newsletter',
							'beehiiv'
						),
					} }
				/>
			);
		};
	},
	'withOmittedBlockIndicator'
);

addFilter(
	'editor.BlockListBlock',
	'beehiiv/omitted-block-indicator',
	withOmittedBlockIndicator
);
