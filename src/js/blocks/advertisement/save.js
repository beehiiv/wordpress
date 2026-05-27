import { useBlockProps, RichText } from '@wordpress/block-editor';

export default function save( { attributes } ) {
	const blockProps = useBlockProps.save();

	return (
		<div { ...blockProps }>
			<RichText.Content
				tagName="p"
				className="beehiiv-advertisement-message"
				value={ attributes.message }
			/>
		</div>
	);
}
