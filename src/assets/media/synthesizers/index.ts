/**
 * Audio synthesis methods.
 * @package    epicurrents/core
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import DirectSynthesizer, { mintDirectBuffer, normalizeChannels } from './direct'
import { renderOffline } from './renderOffline'

export {
    DirectSynthesizer,
    mintDirectBuffer,
    normalizeChannels,
    renderOffline,
}
