/**
 * Build-time global declarations. The Epicurrents application global (`window.__EPICURRENTS__` and
 * its `EpicurrentsGlobal` type) is declared canonically in [application.ts](./application.ts) so that
 * every consuming package inherits it by importing core types; only bundler-level globals live here.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */
/** Path where WebPack serves its public assets (js) from. */
declare let __webpack_public_path__: string
