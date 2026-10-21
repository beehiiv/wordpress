#!/usr/bin/env node
/* eslint-disable no-console -- CLI script, console is its output. */
const { execFileSync } = require( 'child_process' );
const { existsSync } = require( 'fs' );
const path = require( 'path' );
const { loadConfig } = require( '@wordpress/env/lib/config' );
const { assertPhpSeries, assertPhpVersion } = require( './check-php-version' );

const pluginRoot = path.resolve( __dirname, '..' );

function run( command, args, capture = false ) {
	return execFileSync( command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		stdio: [ 'ignore', capture ? 'pipe' : 'inherit', 'inherit' ],
	} );
}

function stop( config, execute = run ) {
	if ( existsSync( config.dockerComposeConfigPath ) ) {
		execute( 'docker', [
			'compose',
			'-f',
			config.dockerComposeConfigPath,
			'stop',
		] );
	}
}

function start( config, execute = run, { buildPatchedImages = false } = {} ) {
	const compose = [ 'compose', '-f', config.dockerComposeConfigPath ];
	const environments = config.testsEnvironment
		? [ 'development', 'tests' ]
		: [ 'development' ];

	try {
		// An existing environment must not keep serving an older PHP while checks run.
		stop( config, execute );
		for ( const environment of environments ) {
			if ( config.env[ environment ].phpmyadmin ) {
				throw new Error(
					'Disable phpmyadmin in wp-env config; its PHP runtime has not been verified.'
				);
			}
			assertPhpSeries( config.env[ environment ].phpVersion );
		}
		const series = new Set(
			environments.map(
				( environment ) => config.env[ environment ].phpVersion
			)
		);
		for ( const phpSeries of series ) {
			for ( const image of [
				`wordpress:php${ phpSeries }`,
				`wordpress:cli-php${ phpSeries }`,
			] ) {
				execute( 'docker', [ 'pull', image ] );
				const readVersion = () =>
					execute(
						'docker',
						[
							'run',
							'--rm',
							'--network',
							'none',
							'--entrypoint',
							'php',
							image,
							'-r',
							'echo PHP_VERSION;',
						],
						true
					);
				try {
					assertPhpVersion( readVersion(), image, phpSeries );
				} catch ( error ) {
					if (
						! buildPatchedImages ||
						error.code !== 'PHP_SECURITY_PATCH_REQUIRED'
					) {
						throw error;
					}
					execute( 'node', [
						path.join( __dirname, 'ci-build-wordpress-image.js' ),
						image,
					] );
					assertPhpVersion( readVersion(), image, phpSeries );
				}
			}
		}
		if ( existsSync( config.dockerComposeConfigPath ) ) {
			// wp-env can reuse old derived images after a base pull. Keep volumes intact.
			execute( 'docker', [ ...compose, 'down', '--rmi', 'local' ] );
		}
		execute( 'npx', [
			'--no-install',
			'wp-env',
			'start',
			'--runtime=docker',
		] );
		for ( const environment of environments ) {
			const prefix = environment === 'tests' ? 'tests-' : '';
			for ( const service of [
				`${ prefix }wordpress`,
				`${ prefix }cli`,
			] ) {
				const version = execute(
					'docker',
					[
						...compose,
						'exec',
						'-T',
						service,
						'php',
						'-r',
						'echo PHP_VERSION;',
					],
					true
				);
				assertPhpVersion(
					version,
					service,
					config.env[ environment ].phpVersion
				);
			}
		}
	} catch ( error ) {
		try {
			stop( config, execute );
		} catch ( stopError ) {
			throw new Error(
				`${ error.message }\nCould not stop wp-env: ${ stopError.message }`
			);
		}
		throw error;
	}
}

if ( require.main === module ) {
	loadConfig( pluginRoot )
		.then( ( config ) => {
			if ( process.argv[ 2 ] === '--stop' ) {
				return stop( config );
			}
			return start( config, run, {
				buildPatchedImages:
					process.env.BEEHIIV_BUILD_PATCHED_WORDPRESS === 'true',
			} );
		} )
		.catch( ( error ) => {
			console.error( `WordPress startup blocked: ${ error.message }` );
			process.exitCode = 1;
		} );
}

module.exports = { start, stop };
