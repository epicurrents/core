/**
 * Worker errors.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 *
 * @remarks
 * I'm not entirely sure if errors should be standardized
 * or not. This concept is still under consideration..
 */

// EDF Worker (SharedArrayBuffer version)
export const CACHE_ALREADY_INITIALIZED = `Signal cache has already been initialized.`
export const COMBINING_SIGNALS_FAILED = `Combining new and existing signals failed.`
export const SIGNAL_CACHE_NOT_INITIALIZED = `Signal cache has not been initialized.`
export const STUDY_PARAMETERS_NOT_SET = `Study parameters have not been set.`
