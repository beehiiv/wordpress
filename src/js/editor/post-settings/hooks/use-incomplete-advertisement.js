/**
 * Detects beehiiv Advertisement blocks that have no advertisement selected.
 *
 * An empty Advertisement block is silently dropped from the newsletter payload,
 * so it is surfaced in the sidebar to prompt the user to select an ad or remove
 * the block before sending.
 */
import { useSelect } from '@wordpress/data';
import { store as blockEditorStore } from '@wordpress/block-editor';

/**
 * @typedef {import('@wordpress/blocks').WPBlock} WPBlock
 */

const ADVERTISEMENT_BLOCK = 'beehiiv/advertisement';

/**
 * Whether any Advertisement block in the tree has no advertisement selected.
 *
 * @param {WPBlock[]} blocks Parsed blocks.
 * @return {boolean} True when an Advertisement block is missing its ad selection.
 */
export function hasIncompleteAdvertisementBlock( blocks ) {
	for ( const block of blocks ) {
		if ( block.name === ADVERTISEMENT_BLOCK && ! block.attributes?.adId ) {
			return true;
		}

		if (
			block.innerBlocks?.length &&
			hasIncompleteAdvertisementBlock( block.innerBlocks )
		) {
			return true;
		}
	}

	return false;
}

/**
 * @return {boolean} Whether the post has an Advertisement block with no ad selected.
 */
export function useHasIncompleteAdvertisement() {
	return useSelect(
		( select ) =>
			hasIncompleteAdvertisementBlock(
				select( blockEditorStore ).getBlocks()
			),
		[]
	);
}
