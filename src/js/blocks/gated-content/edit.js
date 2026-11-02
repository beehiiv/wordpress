import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	InnerBlocks,
	InspectorControls,
	PanelColorSettings,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	Notice,
	PanelBody,
	TextControl,
	TextareaControl,
} from '@wordpress/components';

import { useBeehiivEditorConfig } from '../../editor/post-settings/hooks/use-beehiiv-editor-config';
import renderSettingsLinkMessage from '../../editor/post-settings/utils/render-settings-link-message';

const DIVIDER_BLOCK = 'beehiiv/gated-content-divider';

export default function Edit( { attributes, setAttributes, clientId } ) {
	const { settingsUrl, hasPublication } = useBeehiivEditorConfig();
	const { formId, headline, text, cardBackgroundColor, cardTextColor } =
		attributes;

	const dividerIds = useSelect(
		( select ) =>
			select( 'core/block-editor' )
				.getBlocks( clientId )
				.filter( ( block ) => block.name === DIVIDER_BLOCK )
				.map( ( block ) => block.clientId ),
		[ clientId ]
	);
	const { removeBlocks } = useDispatch( 'core/block-editor' );

	// A gated block holds at most one divider. Keep the first one.
	useEffect( () => {
		if ( dividerIds.length > 1 ) {
			removeBlocks( dividerIds.slice( 1 ) );
		}
	}, [ dividerIds, removeBlocks ] );

	const blockProps = useBlockProps( {
		className: dividerIds.length
			? 'beehiiv-gated-content--has-divider'
			: 'beehiiv-gated-content--no-divider',
	} );

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Gate settings', 'beehiiv' ) }
					initialOpen={ true }
				>
					{ settingsUrl && ! hasPublication && (
						<Notice status="error" isDismissible={ false }>
							{ renderSettingsLinkMessage(
								__(
									'No beehiiv publication is set. Choose one in <a>beehiiv settings</a>.',
									'beehiiv'
								),
								settingsUrl
							) }
						</Notice>
					) }
					<TextControl
						label={ __( 'Subscribe form ID', 'beehiiv' ) }
						value={ formId }
						onChange={ ( value ) =>
							setAttributes( { formId: value.trim() } )
						}
						help={ __(
							'Form must be Inline and set to Show a success message, not Redirect.',
							'beehiiv'
						) }
					/>
					<TextControl
						label={ __( 'Headline', 'beehiiv' ) }
						value={ headline }
						onChange={ ( value ) =>
							setAttributes( { headline: value } )
						}
						help={ __(
							'Leave blank to use the default from the beehiiv settings page.',
							'beehiiv'
						) }
					/>
					<TextareaControl
						label={ __( 'Text', 'beehiiv' ) }
						value={ text }
						onChange={ ( value ) =>
							setAttributes( { text: value } )
						}
						help={ __(
							'Leave blank to use the default from the beehiiv settings page.',
							'beehiiv'
						) }
					/>
				</PanelBody>
				<PanelColorSettings
					title={ __( 'Gate card colors', 'beehiiv' ) }
					initialOpen={ false }
					colorSettings={ [
						{
							label: __( 'Background', 'beehiiv' ),
							value: cardBackgroundColor,
							onChange: ( value ) =>
								setAttributes( {
									cardBackgroundColor: value || '',
								} ),
						},
						{
							label: __( 'Text', 'beehiiv' ),
							value: cardTextColor,
							onChange: ( value ) =>
								setAttributes( { cardTextColor: value || '' } ),
						},
					] }
				/>
			</InspectorControls>

			<div { ...blockProps }>
				<InnerBlocks
					renderAppender={ InnerBlocks.ButtonBlockAppender }
				/>
			</div>
		</>
	);
}
