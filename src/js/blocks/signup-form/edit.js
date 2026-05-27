import { __ } from '@wordpress/i18n';
import { useBlockProps, RichText } from '@wordpress/block-editor';

export default function Edit( { attributes, setAttributes } ) {
	const blockProps = useBlockProps();

	return (
		<div { ...blockProps }>
			<RichText
				tagName="p"
				className="beehiiv-signup-form-message"
				value={ attributes.message }
				onChange={ ( value ) => setAttributes( { message: value } ) }
				placeholder={ __( 'Signup form message…', 'beehiiv' ) }
			/>
		</div>
	);
}
