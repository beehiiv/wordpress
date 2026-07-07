import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	Button,
	Notice,
	PanelBody,
	Placeholder,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { megaphone } from '@wordpress/icons';

export default function Edit( { attributes, setAttributes } ) {
	const { adId, adLabel } = attributes;

	const postId = useSelect(
		( select ) => select( 'core/editor' )?.getCurrentPostId(),
		[]
	);

	const [ ads, setAds ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ justRefreshed, setJustRefreshed ] = useState( false );
	// True only after a request that actually reached beehiiv, so a failed load
	// (empty list from a network/API error) never masquerades as "no ads found".
	const [ lastLoadOk, setLastLoadOk ] = useState( false );
	const noticeTimer = useRef( null );

	useEffect( () => {
		return () => {
			if ( noticeTimer.current ) {
				clearTimeout( noticeTimer.current );
			}
		};
	}, [] );

	const loadAds = useCallback(
		( { refresh = false } = {} ) => {
			if ( ! postId ) {
				return Promise.resolve();
			}

			setIsLoading( true );

			return apiFetch( {
				path: `/beehiiv/v1/advertisement-opportunities?post_id=${ encodeURIComponent(
					postId
				) }${ refresh ? '&refresh=1' : '' }`,
			} )
				.then( ( items ) => {
					setAds( Array.isArray( items ) ? items : [] );
					setLastLoadOk( true );
				} )
				.catch( () => {
					setAds( [] );
					setLastLoadOk( false );
				} )
				.finally( () => {
					setIsLoading( false );
				} );
		},
		[ postId ]
	);

	useEffect( () => {
		loadAds();
	}, [ loadAds ] );

	const handleRefresh = useCallback( () => {
		setJustRefreshed( false );

		if ( noticeTimer.current ) {
			clearTimeout( noticeTimer.current );
		}

		loadAds( { refresh: true } ).then( () => {
			setJustRefreshed( true );
			noticeTimer.current = setTimeout(
				() => setJustRefreshed( false ),
				4000
			);
		} );
	}, [ loadAds ] );

	// The saved ad is gone from beehiiv when a successful load omits it. Guarding on
	// lastLoadOk avoids flagging it as stale after a failed/empty error response.
	const isSelectedAdUnavailable =
		!! adId && lastLoadOk && ! ads.some( ( item ) => item?.id === adId );

	const options = useMemo( () => {
		const opts = [
			{ value: '', label: __( 'Select an advertisement…', 'beehiiv' ) },
			...ads
				.filter( ( item ) => item?.id )
				.map( ( item ) => ( {
					value: item.id,
					label: item.label || item.id,
				} ) ),
		];

		// Keep the saved selection visible even if it isn't in the current list.
		if ( adId && ! opts.some( ( option ) => option.value === adId ) ) {
			const savedLabel = adLabel || adId;

			opts.push( {
				value: adId,
				label: isSelectedAdUnavailable
					? sprintf(
							/* translators: %s: saved advertisement label. */
							__( '%s — no longer available', 'beehiiv' ),
							savedLabel
					  )
					: savedLabel,
			} );
		}

		return opts;
	}, [ ads, adId, adLabel, isSelectedAdUnavailable ] );

	const onSelectAd = ( value ) => {
		const selected = ads.find( ( item ) => item.id === value );

		setAttributes( {
			adId: value,
			adLabel: selected ? selected.label || selected.id : '',
		} );
	};

	const blockProps = useBlockProps();

	const instructions = adId
		? adLabel || adId
		: __(
				'Choose an advertisement in the block settings sidebar. Nothing is shown on the website.',
				'beehiiv'
		  );

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Advertisement', 'beehiiv' ) }
					initialOpen={ true }
				>
					{ isLoading && options.length <= 1 ? (
						<Spinner />
					) : (
						<div className="beehiiv-advertisement-control">
							<SelectControl
								label={ __( 'Advertisement', 'beehiiv' ) }
								value={ adId }
								options={ options }
								onChange={ onSelectAd }
								help={ __(
									'Only ads not already used in another post are listed.',
									'beehiiv'
								) }
								disabled={ isLoading }
								__nextHasNoMarginBottom
							/>
							{ isSelectedAdUnavailable && ! isLoading && (
								<Notice
									status="warning"
									isDismissible={ false }
									className="beehiiv-advertisement__unavailable-notice"
								>
									{ __(
										'The selected advertisement is no longer available in beehiiv and won’t be sent. Choose another or clear it.',
										'beehiiv'
									) }
									<Button
										variant="link"
										onClick={ () => onSelectAd( '' ) }
									>
										{ __( 'Clear selection', 'beehiiv' ) }
									</Button>
								</Notice>
							) }
							<Button
								variant="secondary"
								onClick={ handleRefresh }
								disabled={ isLoading }
								isBusy={ isLoading }
							>
								{ isLoading
									? __( 'Refreshing…', 'beehiiv' )
									: __(
											'Refresh advertisements',
											'beehiiv'
									  ) }
							</Button>
							{ justRefreshed && (
								<p
									className="beehiiv-advertisement__refresh-notice"
									role="status"
								>
									{ __(
										'Advertisements updated from beehiiv.',
										'beehiiv'
									) }
								</p>
							) }
							<p className="beehiiv-advertisement__refresh-help">
								{ __(
									'Opportunities are cached. Refresh to pull the latest from beehiiv.',
									'beehiiv'
								) }
							</p>
						</div>
					) }
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<Placeholder
					icon={ megaphone }
					label={ __( 'beehiiv Advertisement', 'beehiiv' ) }
					instructions={ instructions }
				/>
			</div>
		</>
	);
}
