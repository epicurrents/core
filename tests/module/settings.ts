/**
 * Test module settings.
 * @package    @epicurrents/core
 * @copyright  2023 Sampsa Lohi
 * @license    Apache-2.0
 */

const settings = {
    _settingsMenu: {
        description: 'Test module settings.',
        fields: [
            {
                text: 'Test subtitle',
                type: 'subtitle',
            },
            {
                text: 'Test description.',
                type: 'description',
            },
            {
                component: 'settings-checkbox',
                setting: 'modules.test.testProperty',
                text: 'Change test property',
                type: 'setting',
            },
            {
                component: 'settings-preset',
                presets: [
                    { setting: 'modules.test.testProperty', value: false },
                ],
                text: 'Test preset.',
                type: 'preset',
            },
            {
                component: 'settings-dropdown',
                setting: 'modules.test.testProperty',
                options: [
                    {
                        suffix: '',
                        value: true,
                    },
                    {
                        suffix: '',
                        value: false,
                    },
                    {
                        suffix: 'null',
                        value: null,
                    },
                ],
                text: 'Value of test property',
                type: 'setting',
            },
        ],
        name: {
            full: 'Mock module',
            short: 'mock',
        },
    },
    _userDefinable: {
        'testProperty': Boolean,
    },
    // Display settings
    testProperty: true,
}
export { settings }