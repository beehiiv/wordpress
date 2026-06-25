<?php
/**
 * Beehiiv API: Advertisement opportunities resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Cache;
use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Advertisement opportunities endpoints.
 *
 * @since 1.0.0
 */
final class AdvertisementOpportunities {

	/**
	 * Retrieve advertisement opportunities available for a publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 * @param bool   $use_cache      Whether to read from (and write to) the transient cache.
	 *
	 * @return array<int, array<string, mixed>> Each row: id, advertiser_name, payout_rate,
	 *                                           advertisement_kind, send_by_window_start_at,
	 *                                           send_by_window_end_at, label.
	 */
	public static function get_opportunities( string $publication_id, bool $use_cache = true ): array {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return [];
		}

		if ( $use_cache ) {
			$cached = Cache::get_advertisement_opportunities( $publication_id );

			if ( null !== $cached ) {
				return $cached;
			}
		}

		$path     = sprintf( '/publications/%s/advertisement_opportunities', rawurlencode( $publication_id ) );
		$response = Client::request( $path );

		$items = self::normalize_list( $response );

		if ( $use_cache && ( ! empty( $items ) || 200 === Client::get_last_status_code() ) ) {
			Cache::set_advertisement_opportunities( $publication_id, $items );
		}

		return $items;
	}

	/**
	 * Retrieve only the IDs of available advertisement opportunities.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 * @param bool   $use_cache      Whether to read from the transient cache.
	 *
	 * @return array<int, string>
	 */
	public static function get_active_ad_ids( string $publication_id, bool $use_cache = true ): array {

		return array_column( self::get_opportunities( $publication_id, $use_cache ), 'id' );
	}

	/**
	 * Normalize advertisement opportunity list response data.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $response API response.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private static function normalize_list( array $response ): array {

		$data = isset( $response['data'] ) && is_array( $response['data'] ) ? $response['data'] : [];
		$out  = [];

		foreach ( $data as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$id = isset( $row['id'] ) ? (string) $row['id'] : '';

			if ( '' === $id ) {
				continue;
			}

			$advertiser_name    = isset( $row['advertiser_name'] ) ? (string) $row['advertiser_name'] : '';
			$payout_rate        = isset( $row['payout_rate'] ) ? (string) $row['payout_rate'] : '';
			$advertisement_kind = isset( $row['advertisement_kind'] ) ? (string) $row['advertisement_kind'] : '';
			$start_at           = isset( $row['send_by_window_start_at'] ) ? (int) $row['send_by_window_start_at'] : 0;
			$end_at             = isset( $row['send_by_window_end_at'] ) ? (int) $row['send_by_window_end_at'] : 0;

			$out[] = [
				'id'                      => $id,
				'advertiser_name'         => $advertiser_name,
				'payout_rate'             => $payout_rate,
				'advertisement_kind'      => $advertisement_kind,
				'send_by_window_start_at' => $start_at,
				'send_by_window_end_at'   => $end_at,
				'label'                   => self::build_label(
					$advertiser_name,
					$payout_rate,
					$advertisement_kind,
					$start_at,
					$end_at
				),
			];
		}

		return $out;
	}

	/**
	 * Build a single-line dropdown label in the site timezone.
	 *
	 * Format: "{advertiser} — {payout_rate} · {kind} · {send-by window}".
	 *
	 * @since 1.0.0
	 *
	 * @param string $advertiser_name    Advertiser name.
	 * @param string $payout_rate        Payout rate.
	 * @param string $advertisement_kind Advertisement kind.
	 * @param int    $start_at           Send-by window start (UTC Unix timestamp).
	 * @param int    $end_at             Send-by window end (UTC Unix timestamp).
	 *
	 * @return string
	 */
	private static function build_label(
		string $advertiser_name,
		string $payout_rate,
		string $advertisement_kind,
		int $start_at,
		int $end_at
	): string {

		$parts = array_filter(
			[
				'' !== $advertiser_name ? $advertiser_name : __( 'Advertisement', 'beehiiv' ),
				$payout_rate,
				$advertisement_kind,
				self::format_window( $start_at, $end_at ),
			],
			static function ( $part ) {
				return '' !== $part;
			}
		);

		$advertiser = array_shift( $parts );

		if ( empty( $parts ) ) {
			return (string) $advertiser;
		}

		// "{advertiser} — {detail} · {detail} · …".
		return $advertiser . ' — ' . implode( ' · ', $parts );
	}

	/**
	 * Format the send-by window in the site timezone.
	 *
	 * Collapses to a single date when start and end fall on the same day.
	 *
	 * @since 1.0.0
	 *
	 * @param int $start_at Window start (UTC Unix timestamp).
	 * @param int $end_at   Window end (UTC Unix timestamp).
	 *
	 * @return string Empty string when no timestamps are available.
	 */
	private static function format_window( int $start_at, int $end_at ): string {

		$date_format = (string) get_option( 'date_format' );

		if ( $start_at > 0 && $end_at > 0 ) {
			$start = wp_date( $date_format, $start_at );
			$end   = wp_date( $date_format, $end_at );

			if ( $start === $end ) {
				return (string) $start;
			}

			/* translators: 1: send-by window start date, 2: send-by window end date. */
			return sprintf( __( '%1$s – %2$s', 'beehiiv' ), $start, $end );
		}

		$single = $start_at > 0 ? $start_at : $end_at;

		return $single > 0 ? (string) wp_date( $date_format, $single ) : '';
	}
}
