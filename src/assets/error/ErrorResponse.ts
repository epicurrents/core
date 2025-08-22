/**
 * Error response.
 * @package    epicurrents/core
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

//const SCOPE = 'ErrorResponse'

/**
 * An error response for a request.
 */
export default class ErrorResponse {
    protected _message: string
    protected _original?: { error?: Error, response?: Response }

    /***
     * Creates a new error response.
     * @param message The error message.
     * @param original The original `Error` or `Response` object, if this was a caught exception.
     */
    constructor (message: string, original?: { error?: Error, response?: Response }) {
        this._message = message
        this._original = original
    }

    /** The original `Error` object if this was a caught error, null otherwise. */
    get error () {
        return this._original?.error || null
    }
    /** The error message. */
    get message () {
        return this._message
    }
    /** The original `Response` object if this was an error response, null otherwise. */
    get response () {
        return this._original?.response || null
    }
}
