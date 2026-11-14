/**
 * MQTT-mintaillesztés: `+` egy szintet, a minta végén álló `#` tetszőleges számú
 * szintet helyettesít (a szülő szintet is, tehát `a/#` illeszkedik az `a` topicra).
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  const patternLevels = pattern.split('/');
  const topicLevels = topic.split('/');

  for (let i = 0; i < patternLevels.length; i++) {
    const level = patternLevels[i];
    if (level === '#') return i === patternLevels.length - 1;
    if (i >= topicLevels.length) return false;
    if (level !== '+' && level !== topicLevels[i]) return false;
  }
  return patternLevels.length === topicLevels.length;
}

/** Érvényes feliratkozási minta-e: a `#` csak utolsó szint lehet, a helyettesítők egész szintek. */
export function isValidPattern(pattern: string): boolean {
  if (pattern.length === 0) return false;
  const levels = pattern.split('/');
  return levels.every((level, i) => {
    if (level === '#') return i === levels.length - 1;
    if (level === '+') return true;
    return !level.includes('#') && !level.includes('+');
  });
}
