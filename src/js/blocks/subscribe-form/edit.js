import { __ } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	ExternalLink,
	PanelBody,
	Placeholder,
	TextControl,
} from '@wordpress/components';
import { envelope } from '@wordpress/icons';

const SUBSCRIBE_FORM_DOC_URL =
	'https://www.beehiiv.com/support/article/12977090590487-creating-an-embedded-subscribe-form';

export default function Edit( { attributes, setAttributes } ) {
	const { formId } = attributes;

	const blockProps = useBlockProps( {
		className: 'beehiiv-subscribe-form--is-placeholder',
	} );

	const instructions = formId
		? __(
				'The subscribe form is only rendered on the front-end and cannot be previewed here. View the page to see your form.',
				'beehiiv'
		  )
		: __(
				'Add a subscribe form ID in the block settings sidebar to display your form.',
				'beehiiv'
		  );

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Form settings', 'beehiiv' ) }
					initialOpen={ true }
				>
					<TextControl
						label={ __( 'Subscribe form ID', 'beehiiv' ) }
						value={ formId }
						onChange={ ( value ) =>
							setAttributes( { formId: value.trim() } )
						}
						help={ __(
							'Paste the form ID from your beehiiv embed code (the value of data-beehiiv-form).',
							'beehiiv'
						) }
					/>
					<p className="beehiiv-subscribe-form__doc-link">
						<ExternalLink href={ SUBSCRIBE_FORM_DOC_URL }>
							{ __(
								'Creating an embedded subscribe form',
								'beehiiv'
							) }
						</ExternalLink>
					</p>
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<Placeholder
					icon={ envelope }
					label={ __( 'beehiiv Subscribe Form', 'beehiiv' ) }
					instructions={ instructions }
				>
					<ExternalLink href={ SUBSCRIBE_FORM_DOC_URL }>
						{ __(
							'Creating an embedded subscribe form',
							'beehiiv'
						) }
					</ExternalLink>
				</Placeholder>
			</div>
		</>
	);
}
