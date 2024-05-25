/**
 * Epicurrents core bundled code tests.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import Epicurrents from '../umd/epicurrents'

describe("Epicurrents bundled code tests", () => {
    test("Pre-launch configuration", async () => {
        expect(Epicurrents).toBeDefined()
    })
})