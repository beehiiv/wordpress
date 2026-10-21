#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, console is its output. */
const { execFileSync } = require( 'child_process' );

// https://www.php.net/archive/2026.php#2026-10-21-5
const minimumVersions = {
	8.2: 35,
	8.3: 36,
	8.4: 27,
	8.5: 12,
};

function assertPhpSeries( series ) {
	if ( ! Object.hasOwn( minimumVersions, series ) ) {
		throw new Error(
			`Unsupported PHP series ${ series }; use ${ Object.keys(
				minimumVersions
			).join( ', ' ) } with the October 2026 security fixes.`
		);
	}
}

function assertPhpVersion( version, label = 'PHP', expectedSeries ) {
	const match = /^(\d+\.\d+)\.(\d+)$/.exec( version.trim() );
	if ( ! match ) {
		throw new Error(
			`${ label }: cannot verify PHP version ${ version }.`
		);
	}
	const [ , series, patch ] = match;
	assertPhpSeries( series );
	if ( expectedSeries && series !== expectedSeries ) {
		throw new Error(
			`${ label }: expected PHP ${ expectedSeries }, found ${ version }.`
		);
	}
	if ( Number( patch ) < minimumVersions[ series ] ) {
		throw new Error(
			`${ label }: PHP ${ version } is affected by CVE-2026-109618/CVE-2026-109619; requires ${ series }.${ minimumVersions[ series ] } or newer in that series.`
		);
	}
	console.log( `${ label }: verified PHP ${ version.trim() }.` );
}

if ( require.main === module ) {
	try {
		assertPhpVersion(
			execFileSync( 'php', [ '-r', 'echo PHP_VERSION;' ], {
				encoding: 'utf8',
			} ),
			'Host'
		);
	} catch ( error ) {
		console.error( error.message );
		process.exitCode = 1;
	}
}

module.exports = { assertPhpSeries, assertPhpVersion };
