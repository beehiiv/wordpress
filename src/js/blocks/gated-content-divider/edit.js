import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';

export default function Edit() {
	const blockProps = useBlockProps( {
		className: 'beehiiv-gate-divider',
	} );

	return (
		<div { ...blockProps }>
			<span className="beehiiv-gate-divider__label">
				{ __(
					'Preview ends here. Content below is gated.',
					'beehiiv'
				) }
			</span>
		</div>
	);
}
