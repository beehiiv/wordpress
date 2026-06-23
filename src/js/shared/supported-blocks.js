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
 */

/** @type {BeehiivBlockSupportConfig} */
const DEFAULT_CONFIG = {
	supported: [],
	nestedOnly: [],
	snippetOnly: [],
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
