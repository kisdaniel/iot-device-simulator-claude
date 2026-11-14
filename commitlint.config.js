/** Conventional Commits; a hatókörök listája a docs/technikai-specifikacio.md szerint. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'backend',
        'frontend',
        'shared',
        'shelly',
        'tasmota',
        'mqtt',
        'storage',
        'api',
        'config',
        'docker',
        'docs',
      ],
    ],
    'header-max-length': [2, 'always', 72],
  },
};
