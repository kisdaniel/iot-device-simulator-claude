import { TopicRouter } from './topic-router.js';

describe('TopicRouter', () => {
  it('mintánként számolja a feliratkozókat', () => {
    const router = new TopicRouter();
    const a = vi.fn();
    const b = vi.fn();

    expect(router.add('shellies/command', a)).toBe(true);
    expect(router.add('shellies/command', b)).toBe(false);
    expect(router.remove('shellies/command', a)).toBe(false);
    expect(router.remove('shellies/command', b)).toBe(true);
    expect(router.patterns()).toEqual([]);
  });

  it('minden illeszkedő kezelőt egyszer hív meg', () => {
    const router = new TopicRouter();
    const device = vi.fn();
    const other = vi.fn();
    router.add('cmnd/t1/#', device);
    router.add('cmnd/+/POWER', device);
    router.add('cmnd/t2/#', other);

    const payload = Buffer.from('ON');
    expect(router.dispatch('cmnd/t1/POWER', payload)).toBe(1);
    expect(device).toHaveBeenCalledTimes(1);
    expect(device).toHaveBeenCalledWith('cmnd/t1/POWER', payload);
    expect(other).not.toHaveBeenCalled();
  });

  it('hibás mintára kivételt dob', () => {
    expect(() => new TopicRouter().add('a/#/b', vi.fn())).toThrow();
  });
});
