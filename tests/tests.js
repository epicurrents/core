/**
 * EpiCurrents core bundled code tests.
 * @package    epicurrents/core
 * @copyright  2024 Sampsa Lohi
 * @license    Apache-2.0
 */

import EpiCurrents from '../umd/epicurrents'

describe("EpiCurrents bundled code tests", () => {
    test("Pre-launch configuration", async () => {
        expect(EpiCurrents).toBeDefined()
    })
})