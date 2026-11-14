import { isValidPattern, topicMatches } from './topic-matcher.js';

export type MessageHandler = (topic: string, payload: Buffer) => void;

/**
 * A közös kapcsolat bejövő üzeneteit osztja szét az eszközök között.
 * Mintánként számolja a feliratkozókat, mert a közös topicokra
 * (pl. `shellies/command`, `cmnd/tasmotas/#`) több eszköz is igényt tart.
 */
export class TopicRouter {
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  /** Hozzáad egy kezelőt; igazat ad, ha ez a minta első feliratkozója. */
  add(pattern: string, handler: MessageHandler): boolean {
    if (!isValidPattern(pattern)) {
      throw new Error(`Érvénytelen MQTT-minta: "${pattern}"`);
    }
    let set = this.handlers.get(pattern);
    const first = set === undefined;
    if (!set) {
      set = new Set();
      this.handlers.set(pattern, set);
    }
    set.add(handler);
    return first;
  }

  /** Eltávolít egy kezelőt; igazat ad, ha a mintának nem maradt feliratkozója. */
  remove(pattern: string, handler: MessageHandler): boolean {
    const set = this.handlers.get(pattern);
    if (!set || !set.delete(handler)) return false;
    if (set.size > 0) return false;
    this.handlers.delete(pattern);
    return true;
  }

  patterns(): string[] {
    return [...this.handlers.keys()];
  }

  /** Minden illeszkedő kezelőt pontosan egyszer hív meg; a kezelők számát adja vissza. */
  dispatch(topic: string, payload: Buffer): number {
    const matched = new Set<MessageHandler>();
    for (const [pattern, set] of this.handlers) {
      if (!topicMatches(pattern, topic)) continue;
      for (const handler of set) matched.add(handler);
    }
    for (const handler of matched) handler(topic, payload);
    return matched.size;
  }
}
