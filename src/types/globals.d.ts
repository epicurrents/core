/**
 * Global property type declarations.
 * @package    @epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */
declare global {
    /** Path where WebPack serves its public assets (js) from. */
    let __webpack_public_path__: string
    interface Window {
        /**
         * Runtime state manager of the initiated application.
         */
        __EPICURRENTS_RUNTIME__: import('#types/application').StateManager
    }
}
export {} // Guarantees the global declaration to work.
