/**
 * "Newsletter only" option on Custom HTML blocks.
 *
 * Adds a per-block option that sends the block to beehiiv without showing it on the
 * WordPress site, a label on blocks that have it on, and a notice when the block holds
 * script or iframe elements, which beehiiv does not accept.
 */
import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { createHigherOrderComponent } from '@wordpress/compose';
import { useSelect } from '@wordpress/data';
import {
	InspectorControls,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { Notice, PanelBody, ToggleControl } from '@wordpress/components';

import {
	HTML_BLOCK,
	NEWSLETTER_ONLY_ATTRIBUTE,
	hasUnsupportedHtmlElements,
} from '../utils/html-block';

/**
 * Add the option to the Custom HTML block type.
 *
 * @param {Object} settings Block type settings.
 * @param {string} name     Block name.
 * @return {Object} Block type settings.
 */
function addNewsletterOnlyAttribute( settings, name ) {
	if ( name !== HTML_BLOCK ) {
		return settings;
	}

	return {
		...settings,
		attributes: {
			...settings.attributes,
			[ NEWSLETTER_ONLY_ATTRIBUTE ]: {
				type: 'boolean',
				default: false,
			},
		},
	};
}

const withNewsletterOnlyHtml = createHigherOrderComponent( ( BlockEdit ) => {
	return function BeehiivHtmlBlockEdit( props ) {
		// Newer WordPress versions leave a saved Custom HTML block without a
		// `content` attribute until it is edited. The saved markup is then only
		// on the parsed block, so read it from there as a fallback.
		const savedContent = useSelect(
			( select ) =>
				props.name === HTML_BLOCK
					? select( blockEditorStore ).getBlock( props.clientId )
							?.originalContent
					: undefined,
			[ props.name, props.clientId ]
		);

		if ( props.name !== HTML_BLOCK ) {
			return <BlockEdit { ...props } />;
		}

		const { attributes, setAttributes } = props;
		const isNewsletterOnly = !! attributes[ NEWSLETTER_ONLY_ATTRIBUTE ];
		const hasUnsupported = hasUnsupportedHtmlElements(
			attributes.content ?? savedContent
		);

		return (
			<>
				{ isNewsletterOnly && (
					<p className="beehiiv-newsletter-only-label">
						{ __( 'Newsletter only', 'beehiiv' ) }
					</p>
				) }
				{ hasUnsupported && (
					<Notice
						status="warning"
						isDismissible={ false }
						className="beehiiv-html-unsupported-notice"
					>
						{ __(
							'Script and iframe elements are not included in the newsletter.',
							'beehiiv'
						) }
					</Notice>
				) }
				<BlockEdit { ...props } />
				<InspectorControls>
					<PanelBody title={ __( 'beehiiv', 'beehiiv' ) }>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __( 'Newsletter only', 'beehiiv' ) }
							help={ __(
								'Send this block to the newsletter only. It does not show on your site.',
								'beehiiv'
							) }
							checked={ isNewsletterOnly }
							onChange={ ( value ) =>
								setAttributes( {
									[ NEWSLETTER_ONLY_ATTRIBUTE ]: !! value,
								} )
							}
						/>
					</PanelBody>
				</InspectorControls>
			</>
		);
	};
}, 'withNewsletterOnlyHtml' );

addFilter(
	'blocks.registerBlockType',
	'beehiiv/newsletter-only-html-attribute',
	addNewsletterOnlyAttribute
);

addFilter(
	'editor.BlockEdit',
	'beehiiv/newsletter-only-html',
	withNewsletterOnlyHtml
);
