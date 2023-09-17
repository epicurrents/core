/**
 * Pyodide service.
 * @package    epicurrents-core
 * @copyright  2022 Sampsa Lohi
 * @license    Apache-2.0
 */

import { type AssetService } from 'TYPES/service'
import Log from 'scoped-ts-log'
import GenericService from 'LIB/core/service/GenericService'

const SCOPE = 'PyodideService'

type LoadingState = 'error' | 'loaded' | 'loading' | 'not_loaded'
type ScriptState = {
    params: { [key: string]: any }
    state: LoadingState
}
export default class PyodideService extends GenericService implements AssetService {
    protected _callbacks = [] as ((...results: any[]) => any)[]
    protected _loadedPackages = [] as string[]
    /**
     * Some scripts are run only once and kept in memory.
     * This property lists names of scripts that should not be run multiple times and their loading state.
     */
    protected _scripts = {} as { [name: string]: ScriptState }

    constructor () {
        super(SCOPE, new Worker(new URL("./PyodideWorker.ts", import.meta.url)))
    }

    /**
     * Load the given packages into the Python interpreter.
     * @param packages - Array of package names to load.
     */
    async loadPackages (packages: string[]) {
        packages = packages.filter(pkg => (this._loadedPackages.indexOf(pkg) === -1))
        const commission = this._commissionWorker(
            'load-packages',
            new Map<string, any>([
                ['packages', packages],
            ])
        )
        const response = await commission.promise
        if (response.success) {
            this._loadedPackages.push(...packages)
        }
        return response
    }

    /**
     * Run the provided piece of `code` with the given `parameters`.
     * @param code - Python code as a string.
     * @param params - Any parameters for the code.
     */
    async runCode (code: string, params: { [key: string]: any }) {
        const commission = this._commissionWorker(
            'run-code',
            new Map<string, any>([
                ['code', code],
                ...Object.entries(params)
            ])
        )
        return commission.promise
    }

    /**
     * Load and run the `script` using the given `parameters`.
     * @param script - Name of the script.
     * @param params - Parameters for execution.
     */
    async runScript (script: string, params: { [key: string]: any }) {
        if (script in this._scripts) {
            if (
                this._scripts[script].state === 'loading' ||
                this._scripts[script].state === 'loaded'
            ) {
                Log.info(`Script ${script} is already loading or has been loaded.`, SCOPE)
                return {
                    success: true,
                }
            }
            this._scripts[script].params = { ...params }
            this._scripts[script].state = 'loading'
        }
        const commission = this._commissionWorker(
            'run-script',
            new Map<string, any>([
                ['script', script],
                ...Object.entries(params)
            ])
        )
        const response = await commission.promise
        if (response.success) {
            if (script in this._scripts) {
                this._scripts[script].state = 'loaded'
            }
        }
        return response
    }

    async setupContext (context: string) {
        // Load context-specific packages
        //if (context === 'eeg') {
        //    await this.loadPackages(['scipy', 'matplotlib', 'mne'])
        //}
    }
}
