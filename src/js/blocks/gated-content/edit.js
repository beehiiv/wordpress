import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	InnerBlocks,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';

const DIVIDER_BLOCK = 'beehiiv/gated-content-divider';

export default function Edit( { attributes, setAttributes, clientId } ) {
	const { formId, headline, text } = attributes;

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
			</InspectorControls>

			<div { ...blockProps }>
				<InnerBlocks
					renderAppender={ InnerBlocks.ButtonBlockAppender }
				/>
			</div>
		</>
	);
}
