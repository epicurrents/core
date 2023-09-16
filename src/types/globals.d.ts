/**
 * Global property types.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { PyodideService } from "LIB/pyodide"

export type GlobalProperties = {
    PYODIDE: null | PyodideService
}

declare const __webpack_public_path__: string
