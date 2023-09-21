/**
 * Pyodide runner.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { loadPyodide } from "pyodide/pyodide.js"
import Log from "scoped-ts-log"

const SCOPE = 'PyodideRunner'

export default class PyodideRunner {
    protected _loadPromise: Promise<void>
    protected _pyodide = null as Pyodide | null

    constructor () {
        this._loadPromise = this.loadPyodideAndPackages()
    }

    async loadPyodideAndPackages () {
        // Load main Pyodide
        this._pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.19.1/full/",
        })
        // Load packages that are common to all contexts.
        await this._pyodide?.loadPackage(['numpy'])
    }

    async loadPackages (packages: string[]) {
        await this._loadPromise
        await this._pyodide?.loadPackage(packages)
    }

    async runCode (code: string, params?: { [key: string]: any }) {
        await this._loadPromise
        if (params) {
            for (const key in params) {
                // Check for prototype injection attempt.
                if (key.includes('__proto__')) {
                    Log.warn(`Code param ${key} contains insecure field '__proto__', parameter was ignored.`, SCOPE)
                    continue
                }
                ;(window as any)[key] = params[key]
            }
        }
        const results = await this._pyodide?.runPythonAsync(code)
        return results
    }

    async runScript (name: string, params: { [key: string]: any }) {
        await this._loadPromise
        const script = require(`!!raw-loader!SRC/workers/scripts/${name}.py`)
        for (const key in params) {
            if (key.includes('__proto__')) {
                Log.warn(`Code param ${key} contains insecure field '__proto__', parameter was ignored.`, SCOPE)
                continue
            }
            ;(this._pyodide as any)[key] = params[key]
        }
        const results = await this._pyodide?.runPythonAsync(script.default)
        return results
    }

    async setChannels (chans: string[]) {
        await this._loadPromise
        const channels = JSON.stringify(chans)
        const results = await this._pyodide?.runPythonAsync('set_montage()')
    }

    async setData (values: number[]) {
        await this._loadPromise
        const data = JSON.stringify(values)
        const results = await this._pyodide?.runPythonAsync('set_montage()')
    }

    async setMontage (mtg: string) {
        await this._loadPromise
        const montage = mtg
        const results = await this._pyodide?.runPythonAsync('set_montage()')
    }

    async setupContext (context: string) {
        await this._loadPromise
        // Load context-specific packages.
        if (context === 'eeg') {
            await this.loadPackages(['scipy', 'matplotlib', 'mne'])
        }
    }
}
