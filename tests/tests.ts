/**
 * EpiCurrents core tests.
 * @package    epicurrents-core
 * @copyright  2021 Sampsa Lohi
 * @license    Apache-2.0
 */

import { EpiCurrents } from "../src/index"
import { Log } from 'scoped-ts-log'

describe('EpiCurrents core tests', () => {
    var epic: EpiCurrents
    test("Create core application with log level debug", () => {
        console.log(EpiCurrents)
        epic = new EpiCurrents("DEBUG")
        expect(epic).toBeDefined()
        expect(Log.getPrintThreshold()).toStrictEqual("DEBUG")
    })
})
