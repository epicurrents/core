/**
 * Global property type declarations.
 * @package    @epicurrents/core
 * @copyright  2020 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */
declare global {
    let __webpack_public_path__: string
    interface Window {
        /**
         * List of initiated EpiCurrents applications.
         */
        __EPICURRENTS_RUNTIME__: import('#types/application').StateManager
    }
    /** Path where WebPack serves its public assets (js) from. */
}
export {} // Guarantees the global declaration to work.
