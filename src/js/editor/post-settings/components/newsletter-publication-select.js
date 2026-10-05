/**
 * Publication picker for a post's newsletter.
 */
import { useMemo } from '@wordpress/element';
import { SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

/**
 * @param {Object}                            props
 * @param {Array<{id: string, name: string}>} props.publications Connected publications.
 * @param {string}                            props.value        Publication to show as selected, or empty.
 * @param {(value: string) => void}           props.onChange     Called when the user picks a publication.
 * @param {boolean}                           [props.disabled]   Whether the choice is locked.
 */
export default function NewsletterPublicationSelect( {
	publications,
	value,
	onChange,
	disabled = false,
} ) {
	const options = useMemo( () => {
		const opts = publications.map( ( item ) => ( {
			value: item.id,
			label: item.name || item.id,
		} ) );

		if ( value && ! opts.some( ( option ) => option.value === value ) ) {
			opts.push( {
				value,
				label: sprintf(
					/* translators: %s: beehiiv publication ID */
					__( '%s (no longer connected)', 'beehiiv' ),
					value
				),
			} );
		}

		if ( ! value ) {
			opts.unshift( {
				value: '',
				label: __( 'Select a publication', 'beehiiv' ),
			} );
		}

		return opts;
	}, [ publications, value ] );

	if ( publications.length === 0 && ! value ) {
		return null;
	}

	return (
		<div className="beehiiv-newsletter-publication">
			<SelectControl
				label={ __( 'Publication', 'beehiiv' ) }
				value={ value }
				options={ options }
				onChange={ onChange }
				disabled={ disabled }
				help={
					disabled
						? __(
								'The newsletter has been sent, so its publication can no longer change.',
								'beehiiv'
						  )
						: undefined
				}
				__nextHasNoMarginBottom
			/>
		</div>
	);
}
