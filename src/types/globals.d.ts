/**
 * Global property types and non-typed module declarations.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

declare const __webpack_public_path__: string
declare module 'codecutils' {
    const CodecUtils: {
        extractTypedArray: any
        getString8FromBuffer: any
    }
}

declare module 'd3-interpolate' {
    function interpolateNumber (a: number, b: number): (c: number) => number
    export { interpolateNumber }
}

declare module 'fili' {
    const Fili: any
    export default Fili
}

declare type Pyodide = {
    runPythonAsync (code: string): Promise<string>
    loadPackage (packages: string | string[]): Promise<void>
}

declare module 'pyodide/pyodide.js' {
    export function loadPyodide (config: { indexURL: string }): Promise<Pyodide>
}

declare const loadPyodide: (params: any) => Promise<any>
