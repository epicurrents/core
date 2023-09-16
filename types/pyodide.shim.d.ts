/**
 * Pyodide shims.
 * @package    epicurrents-core
 * @copyright  2020 Sampsa Lohi
 * @license    Apache-2.0
 */

type Pyodide = {
    runPythonAsync (code: string): Promise<string>
    loadPackage (packages: string | string[]): Promise<void>
}

declare module 'pyodide/pyodide.js' {
    export function loadPyodide (config: { indexURL: string }): Promise<Pyodide>
}

declare const loadPyodide: (params: any) => Promise<any>
