/**
 * Publication picker for a post's newsletter.
 */
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { Button, SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import { refreshEditorPublications } from '../hooks/use-editor-publications';

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
	const [ isRefreshing, setIsRefreshing ] = useState( false );
	const [ justRefreshed, setJustRefreshed ] = useState( false );
	const noticeTimer = useRef( null );

	useEffect( () => {
		return () => {
			if ( noticeTimer.current ) {
				clearTimeout( noticeTimer.current );
			}
		};
	}, [] );

	const handleRefresh = () => {
		setJustRefreshed( false );
		setIsRefreshing( true );

		if ( noticeTimer.current ) {
			clearTimeout( noticeTimer.current );
		}

		refreshEditorPublications()
			.then( ( refreshed ) => {
				if ( ! refreshed ) {
					return;
				}

				setJustRefreshed( true );
				noticeTimer.current = setTimeout(
					() => setJustRefreshed( false ),
					4000
				);
			} )
			.finally( () => setIsRefreshing( false ) );
	};

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
				disabled={ disabled || isRefreshing }
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
			<Button
				variant="secondary"
				onClick={ handleRefresh }
				disabled={ disabled || isRefreshing }
				isBusy={ isRefreshing }
			>
				{ isRefreshing
					? __( 'Refreshing…', 'beehiiv' )
					: __( 'Refresh publications', 'beehiiv' ) }
			</Button>
			{ justRefreshed && (
				<p
					className="beehiiv-newsletter-publication__refresh-notice"
					role="status"
				>
					{ __( 'Publications updated from beehiiv.', 'beehiiv' ) }
				</p>
			) }
		</div>
	);
}
