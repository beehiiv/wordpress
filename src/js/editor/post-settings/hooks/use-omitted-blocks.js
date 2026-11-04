/**
 * Tracks blocks omitted from the beehiiv newsletter payload.
 */
import { useSelect } from '@wordpress/data';
import { store as blockEditorStore } from '@wordpress/block-editor';

import { isOmittedFromNewsletter } from '../../../shared/supported-blocks';

/**
 * @typedef {import('@wordpress/blocks').WPBlock} WPBlock
 */

/**
 * @typedef {Object} BlockAncestor
 * @property {string} clientId Block client ID.
 * @property {string} name     Block name.
 */

/**
 * Resolve the outermost omitted block for an unsupported block in the tree.
 *
 * @param {BlockAncestor[]} ancestors     Root-to-parent chain for the block.
 * @param {string}          blockClientId Client ID of the unsupported block.
 * @return {string} Client ID of the omitted block to highlight.
 */
function resolveOmittedBlockTarget( ancestors, blockClientId ) {
	for ( const ancestor of ancestors ) {
		if ( isOmittedFromNewsletter( ancestor ) ) {
			return ancestor.clientId;
		}
	}

	return blockClientId;
}

/**
 * Whether a Group block sits inside another Group block.
 *
 * beehiiv sections cannot hold sections, so the inner Group is omitted.
 *
 * @param {WPBlock}         block     Block being visited.
 * @param {BlockAncestor[]} ancestors Root-to-parent chain for the block.
 * @return {boolean} True when the block is a Group nested in a Group.
 */
function isGroupInsideGroup( block, ancestors ) {
	return (
		'core/group' === block.name &&
		ancestors.some( ( ancestor ) => 'core/group' === ancestor.name )
	);
}

/**
 * Collect client IDs for blocks omitted from the newsletter.
 *
 * @param {WPBlock[]} blocks Parsed top-level blocks.
 * @return {Set<string>} Client IDs of omitted blocks to highlight.
 */
export function collectOmittedBlockClientIds( blocks ) {
	/** @type {Set<string>} */
	const targets = new Set();

	/**
	 * @param {WPBlock[]}       blockList
	 * @param {BlockAncestor[]} ancestors Root-to-parent chain.
	 */
	function visit( blockList, ancestors = [] ) {
		for ( const block of blockList ) {
			if (
				isOmittedFromNewsletter( block ) ||
				isGroupInsideGroup( block, ancestors )
			) {
				targets.add(
					resolveOmittedBlockTarget( ancestors, block.clientId )
				);
				continue;
			}

			if ( block.innerBlocks?.length ) {
				visit( block.innerBlocks, [
					...ancestors,
					{ clientId: block.clientId, name: block.name },
				] );
			}
		}
	}

	visit( blocks );

	return targets;
}

/**
 * Number of blocks that will be omitted from the newsletter.
 *
 * @return {number} Count of omitted top-level block targets.
 */
export function useOmittedBlockCount() {
	return useSelect( ( select ) => {
		const blocks = select( blockEditorStore ).getBlocks();

		return collectOmittedBlockClientIds( blocks ).size;
	}, [] );
}

/**
 * Whether a block should show omitted-block canvas indicators.
 *
 * @param {string} clientId Block client ID.
 * @return {boolean} Whether the block should be visually marked as omitted.
 */
export function useIsOmittedBlock( clientId ) {
	return useSelect(
		( select ) => {
			const blockEditor = select( blockEditorStore );
			const targets = collectOmittedBlockClientIds(
				blockEditor.getBlocks()
			);

			if ( ! targets.has( clientId ) ) {
				return false;
			}

			const parents = blockEditor.getBlockParents( clientId );

			return ! parents.some( ( parentId ) => targets.has( parentId ) );
		},
		[ clientId ]
	);
}
