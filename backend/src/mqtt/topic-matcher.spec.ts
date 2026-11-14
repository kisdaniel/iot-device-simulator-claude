import { isValidPattern, topicMatches } from './topic-matcher.js';

describe('topicMatches', () => {
  it.each([
    ['a/b', 'a/b', true],
    ['a/b', 'a/c', false],
    ['a/+', 'a/b', true],
    ['a/+', 'a/b/c', false],
    ['a/+/c', 'a/b/c', true],
    ['+/rpc', 'shelly1pmg3-aabb/rpc', true],
    ['cmnd/tasmota_1/#', 'cmnd/tasmota_1/POWER', true],
    ['cmnd/tasmota_1/#', 'cmnd/tasmota_1/a/b', true],
    ['cmnd/tasmota_1/#', 'cmnd/tasmota_1', true],
    ['cmnd/tasmota_1/#', 'cmnd/tasmota_10/POWER', false],
    ['#', 'bármi/akármi', true],
    ['a/b', 'a', false],
    ['a', 'a/b', false],
  ])('%s ~ %s → %s', (pattern, topic, expected) => {
    expect(topicMatches(pattern, topic)).toBe(expected);
  });
});

describe('isValidPattern', () => {
  it('elfogadja a szabályos mintákat', () => {
    for (const p of ['a', 'a/b', 'a/+/c', 'a/#', '#', '+']) {
      expect(isValidPattern(p)).toBe(true);
    }
  });

  it('elutasítja a hibás helyettesítőket', () => {
    for (const p of ['', 'a/#/b', 'a/b#', 'a+/b']) {
      expect(isValidPattern(p)).toBe(false);
    }
  });
});
