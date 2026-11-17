/**
 * WordPress blocks supported for beehiiv newsletter conversion.
 *
 * Config is localized from `Beehiiv\Newsletter\SupportedBlocks` (PHP).
 */

/**
 * @typedef {Object} BeehiivBlockSupportConfig
 * @property {string[]} supported   Blocks converted to beehiiv newsletter blocks.
 * @property {string[]} nestedOnly  Inner blocks handled by a parent.
 * @property {string[]} snippetOnly Blocks only used in snippet newsletter mode.
 * @property {number}   maxColumns  Most columns a Columns block can hold before it is omitted.
 */

/** @type {BeehiivBlockSupportConfig} */
const DEFAULT_CONFIG = {
	supported: [],
	nestedOnly: [],
	snippetOnly: [],
	maxColumns: 3,
};

/**
 * @return {BeehiivBlockSupportConfig} Block support config from PHP localization.
 */
function getConfig() {
	if (
		typeof window !== 'undefined' &&
		window.beehiivBlockSupport &&
		typeof window.beehiivBlockSupport === 'object'
	) {
		return window.beehiivBlockSupport;
	}

	return DEFAULT_CONFIG;
}

/**
 * Whether a block is converted for beehiiv newsletters.
 *
 * @param {string}  blockName   Block name (e.g. core/paragraph).
 * @param {boolean} snippetMode Whether snippet newsletter mode is enabled.
 * @return {boolean} True when the block is included in the newsletter payload.
 */
export function isBeehiivSupportedBlock( blockName, snippetMode ) {
	const { supported, nestedOnly, snippetOnly } = getConfig();

	if ( nestedOnly.includes( blockName ) ) {
		return true;
	}

	if ( snippetOnly.includes( blockName ) ) {
		return snippetMode;
	}

	return supported.includes( blockName );
}

/**
 * Whether the editor should show an unsupported-block warning for this block.
 *
 * @param {string} blockName Block name.
 * @return {boolean} True when a warning notice should render above the block.
 */
export function shouldWarnUnsupportedBlock( blockName ) {
	const { supported, nestedOnly, snippetOnly } = getConfig();

	if ( nestedOnly.includes( blockName ) ) {
		return false;
	}

	if ( snippetOnly.includes( blockName ) ) {
		return false;
	}

	return ! supported.includes( blockName );
}

const MEDIA_TEXT_BLOCK = 'core/media-text';

/**
 * Whether a Media & Text block uses video on the media side.
 *
 * The entire block is omitted from the beehiiv payload when video is present.
 *
 * @param {{ name?: string, attributes?: { mediaType?: string } }} block Parsed block.
 * @return {boolean} True when the block uses unsupported video media.
 */
export function isMediaTextWithUnsupportedVideo( block ) {
	if ( block?.name !== MEDIA_TEXT_BLOCK ) {
		return false;
	}

	return 'video' === block.attributes?.mediaType;
}

const COLUMNS_BLOCK = 'core/columns';
const COLUMN_BLOCK = 'core/column';

/**
 * Whether a Columns block has more columns than beehiiv accepts.
 *
 * The entire block is omitted from the beehiiv payload when it has.
 *
 * @param {{ name?: string, innerBlocks?: Array<{ name?: string }> }} block Parsed block.
 * @return {boolean} True when the block has too many columns.
 */
export function isColumnsWithTooManyColumns( block ) {
	if ( block?.name !== COLUMNS_BLOCK ) {
		return false;
	}

	const { maxColumns } = getConfig();
	const columns = ( block.innerBlocks ?? [] ).filter(
		( inner ) => inner?.name === COLUMN_BLOCK
	);

	return columns.length > ( maxColumns ?? DEFAULT_CONFIG.maxColumns );
}

/**
 * Whether a block is omitted from the beehiiv newsletter payload.
 *
 * @param {{ name?: string, attributes?: { mediaType?: string }, innerBlocks?: Array<{ name?: string }> }} block Parsed block.
 * @return {boolean} True when the block will not be sent.
 */
export function isOmittedFromNewsletter( block ) {
	if ( ! block?.name ) {
		return false;
	}

	if ( isMediaTextWithUnsupportedVideo( block ) ) {
		return true;
	}

	if ( isColumnsWithTooManyColumns( block ) ) {
		return true;
	}

	return shouldWarnUnsupportedBlock( block.name );
}
