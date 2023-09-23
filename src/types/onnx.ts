/**
 * ONNX loader types.
 * @package    epicurrents-core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalResource } from "./biosignal"
import { BaseAsset } from "./assets"
import { AssetService } from "./service"

/**
 * An ONNX model that is available in this scope.
 */
export type AvailableOnnxModel = {
    name: string
    supportedStudyTypes: string[]
    worker: Worker
}
export type AvailableOnnxModelPublicProperties = Omit<AvailableOnnxModel, "worker" | "supportedStudyTypes">
                                                 & { supportsStudy: (study: BaseAsset) => boolean }
/**
 * Service class for interacting with an ONNX model.
 */
export interface OnnxService extends AssetService {
    /** Currently active ONNX model (name). */
    activeModel: string | null
    /**
     * A Map containing properties of the models available in this loader.
     * * Full name of the model.
     * * A list of study types supported by the model.
     */
    availableModels: Map<string, AvailableOnnxModelPublicProperties>
    /** Is the model ready to be run. */
    isReady: boolean
    /** Is the model in the process of loading. */
    modelLoading: boolean
    /** Is there a run in progress. */
    runInProgress: boolean
    /** Current run progress as a fraction. */
    runProgress: number
    /**
     * Handle messages from the worker.
     * @param message - Message from the web worker.
     * @returns Promise that fulfills with true if message was handled, false otherwise.
     */
    handleMessage (message: any): Promise<boolean>
    /**
     * Load the given model into a web worker.
     * @param model - Name of the model (case-insensitive) or null to unload current model.
     * @returns Promise that fulfills with true if loading was successful, false otherwise.
     */
    loadModel (model: string | null): Promise<boolean>
    /**
     * Pause the running model.
     */
    pauseRun (): void
    /**
     * Prepare the web worker for loading a model.
     * @return Promise that fulfills when peparation is complete.
     */
    prepare (): Promise<void>
    /**
     * Reset all progress-related parameters, including the target.
     * Any active runs will be stopped.
     */
    resetProgress (): void
    /**
     * Run the active model.
     * **NOTE!** This is just a template method and must be overridden in the child class.
     */
    run (): Promise<void>
    /**
     * Set the target for run progress.
     * @param target - Target at which run is coinsidered complete.
     */
    setProgressTarget (target: number): void
    /**
     * Set a new resource as the data source for this loader.
     * @param resource - The new data source.
     * @param childScope - Optional scope if this method is called from a child class.
     * @returns True if successful, false otherwise.
     */
    setSourceResource (resource: BiosignalResource | null, childScope?: string): boolean
}
export type OnnxServiceReject = (reason: string) => void
export type OnnxServiceResolve = (result: any) => void
