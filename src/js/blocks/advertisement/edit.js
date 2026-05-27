import { __ } from '@wordpress/i18n';
import { useBlockProps, RichText } from '@wordpress/block-editor';

export default function Edit( { attributes, setAttributes } ) {
	const blockProps = useBlockProps();

	return (
		<div { ...blockProps }>
			<RichText
				tagName="p"
				className="beehiiv-advertisement-message"
				value={ attributes.message }
				onChange={ ( value ) => setAttributes( { message: value } ) }
				placeholder={ __( 'Advertisement placeholder…', 'beehiiv' ) }
			/>
		</div>
	);
}
