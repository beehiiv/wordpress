import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { useBlockProps } from '@wordpress/block-editor';

export default function Edit( { clientId } ) {
	const blockProps = useBlockProps( {
		className: 'beehiiv-gate-divider',
	} );

	// Only the first divider in a gated block counts. Flag any later one.
	const isIgnored = useSelect(
		( select ) => {
			const editor = select( 'core/block-editor' );
			const parentId = editor.getBlockRootClientId( clientId );
			const firstDivider = editor
				.getBlocks( parentId )
				.find(
					( block ) => block.name === 'beehiiv/gated-content-divider'
				);

			return firstDivider ? firstDivider.clientId !== clientId : false;
		},
		[ clientId ]
	);

	return (
		<div { ...blockProps }>
			<span className="beehiiv-gate-divider__label">
				{ isIgnored
					? __(
							'Ignored. Only the first divider is used. Delete this one.',
							'beehiiv'
					  )
					: __(
							'Preview ends here. Content below is gated.',
							'beehiiv'
					  ) }
			</span>
		</div>
	);
}
