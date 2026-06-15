import { useMemo } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	PanelBody,
	Placeholder,
	SandBox,
	TextControl,
} from '@wordpress/components';
import { envelope } from '@wordpress/icons';

const LOADER_URL = 'https://subscribe-forms.beehiiv.com/v3/loader.js';
const SUBSCRIBE_FORM_DOC_URL =
	'https://www.beehiiv.com/support/article/12977090590487-creating-an-embedded-subscribe-form';

/**
 * Escape a value for safe use inside an HTML attribute.
 *
 * @param {string} value Raw attribute value.
 * @return {string} Escaped value.
 */
function escapeAttribute( value ) {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /"/g, '&quot;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

export default function Edit( { attributes, setAttributes } ) {
	const { formId } = attributes;

	const previewHtml = useMemo( () => {
		if ( ! formId ) {
			return '';
		}

		const escapedFormId = escapeAttribute( formId );

		return `<script async src="${ LOADER_URL }" data-beehiiv-form="${ escapedFormId }"></script>`;
	}, [ formId ] );

	const blockProps = useBlockProps( {
		className: formId
			? 'beehiiv-subscribe-form--has-preview'
			: 'beehiiv-subscribe-form--is-placeholder',
	} );

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
				{ formId ? (
					<div className="beehiiv-subscribe-form__preview">
						<SandBox
							allowSameOrigin
							html={ previewHtml }
							title={ __(
								'beehiiv subscribe form preview',
								'beehiiv'
							) }
							type="embed"
							tabIndex={ -1 }
						/>
						<div
							className="beehiiv-subscribe-form__preview-overlay"
							aria-hidden="true"
						/>
					</div>
				) : (
					<Placeholder
						icon={ envelope }
						label={ __( 'beehiiv Subscribe Form', 'beehiiv' ) }
						instructions={ __(
							'Add a subscribe form ID in the block settings sidebar to display your form.',
							'beehiiv'
						) }
					>
						<ExternalLink href={ SUBSCRIBE_FORM_DOC_URL }>
							{ __(
								'Creating an embedded subscribe form',
								'beehiiv'
							) }
						</ExternalLink>
					</Placeholder>
				) }
			</div>
		</>
	);
}
