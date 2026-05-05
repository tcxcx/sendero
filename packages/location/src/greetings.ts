/**
 * Creative, context-aware, locale-aware micro-greetings.
 *
 * Gateman — Assume Nothing:
 *  - Don't assume rain = bad ("Perfect desk weather" is neutral-positive)
 *  - Don't assume late night = insomnia (could be the user's normal schedule)
 *  - Don't assume what the user is doing — acknowledge the *vibe*, not the *task*
 *  - Never judgmental ("You should sleep") — always affirming or playful
 *  - Don't assume all users read English — provide native phrases per locale
 *  - Don't assume name position — Japanese/Korean/Chinese put name FIRST
 *
 * Gateman — Worship None:
 *  - "Good morning" is bland. The weather icon already signals time.
 *  - Don't worship English-only UX. Culture-aware greetings build trust.
 *
 * {name} placeholder: positioned correctly per language grammar.
 * Easter egg: "Al que madruga, dios le ayuda" in dawn for Latin-script locales.
 * Phrases rotate daily (deterministic by day-of-year).
 */

// ── Timezone utilities (pure functions, no server deps) ───────────

export function getHourInTimezone(timezone: string | undefined): number {
  try {
    if (!timezone) return new Date().getHours();
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return new Date().getHours();
  }
}

export function format24hTime(timezone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }
}

// ── Weather categories from WMO codes ─────────────────────────────

type WeatherVibe = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'hot' | 'freezing';

function getWeatherVibe(weatherCode?: number, temperature?: number): WeatherVibe | null {
  if (weatherCode == null) return null;
  if (temperature != null && temperature > 32) return 'hot';
  if (temperature != null && temperature < 2) return 'freezing';
  if (weatherCode === 0) return 'clear';
  if (weatherCode >= 1 && weatherCode <= 3) return 'cloudy';
  if (weatherCode === 45 || weatherCode === 48) return 'fog';
  if (weatherCode >= 51 && weatherCode <= 65) return 'rain';
  if (weatherCode === 66 || weatherCode === 67) return 'freezing';
  if (weatherCode >= 71 && weatherCode <= 77) return 'snow';
  if (weatherCode >= 80 && weatherCode <= 82) return 'rain';
  if (weatherCode === 85 || weatherCode === 86) return 'snow';
  if (weatherCode >= 95) return 'storm';
  return null;
}

// ── Name resolution ───────────────────────────────────────────────

/**
 * Splits a phrase template on {name} into before/after parts.
 * If no {name} in template, returns full text as `before`.
 * If displayName is null, cleans separators around the placeholder.
 */
function resolveTemplate(
  template: string,
  displayName?: string | null
): { before: string; after: string } {
  if (!template.includes('{name}')) {
    return { before: template, after: '' };
  }

  const idx = template.indexOf('{name}');
  const rawBefore = template.slice(0, idx);
  const rawAfter = template.slice(idx + 6); // '{name}'.length = 6

  if (displayName) {
    return { before: rawBefore, after: rawAfter };
  }

  // No name — clean separators and join
  const cleanBefore = rawBefore.replace(/[,،、，]\s*$/, '').trim();
  const cleanAfter = rawAfter.replace(/^[,،、，]\s*/, '').trim();

  if (cleanBefore && cleanAfter) {
    return { before: `${cleanBefore} ${cleanAfter}`, after: '' };
  }
  if (cleanAfter) {
    // Capitalize first letter for Latin scripts
    const cap = /[a-záéíóúàèìòùäëïöüâêîôûãõñç]/i.test(cleanAfter[0]!)
      ? cleanAfter[0]!.toUpperCase() + cleanAfter.slice(1)
      : cleanAfter;
    return { before: cap, after: '' };
  }
  return { before: cleanBefore || 'Hello', after: '' };
}

// ── Phrase pools per locale ───────────────────────────────────────
// {name} is positioned per language grammar.
// Easter egg "Al que madruga, dios le ayuda" in dawn for Latin-script locales only.
// Fallback chain: locale+slot+vibe → locale+slot → en+slot+vibe → en+slot

type PhrasePool = Record<string, string[]>;

const EASTER_EGG = 'Al que madruga, dios le ayuda';

// ─────────────── English (en) ─────────────────────────────────────
const en: PhrasePool = {
  latenight: ['Night owl mode, {name}', '{name}, burning late', 'Midnight energy, {name}'],
  latenight_clear: ['Moonlit session, {name}', 'Under the stars, {name}'],
  latenight_rain: ['Midnight rain vibes, {name}', 'Rainy night owl, {name}'],
  latenight_storm: ['Thunder & focus, {name}', 'Storm-powered, {name}'],
  latenight_snow: ['Frosty midnight, {name}', 'Snowfall & focus, {name}'],
  latenight_fog: ['Misty midnight, {name}', 'Foggy night owl, {name}'],

  dawn: ['Up before the world, {name}', 'First mover, {name}', 'Dawn patrol, {name}', EASTER_EGG],
  dawn_clear: ['Chasing sunrise, {name}', 'Early light, {name}', 'Golden dawn, {name}'],
  dawn_rain: ['Rainy dawn riser, {name}', 'Wet sunrise, {name}'],
  dawn_fog: ['Misty morning, {name}', 'Foggy dawn, {name}'],
  dawn_snow: ['Snowy dawn, {name}', 'Winter early bird, {name}'],

  morning: ['Fresh momentum, {name}', "Let's build, {name}", 'Morning energy, {name}'],
  morning_clear: ['Bright day ahead, {name}', 'Sunny & ready, {name}', 'Crystal clear, {name}'],
  morning_cloudy: ['Soft morning light, {name}', 'Cloudy but charged, {name}'],
  morning_rain: [
    'Perfect desk weather, {name}',
    'Rainy focus mode, {name}',
    'Cozy productivity, {name}',
  ],
  morning_snow: ['Snow day hustle, {name}', 'Winter wonderwork, {name}'],
  morning_storm: ['Thunder & tasks, {name}', 'Stormy focus, {name}'],
  morning_hot: ['Sizzling start, {name}', 'Hot morning ahead, {name}'],
  morning_fog: ['Foggy focus, {name}', 'Misty morning, {name}'],
  morning_freezing: ['Frosty start, {name}', 'Bundle up & build, {name}'],

  afternoon: ['Afternoon flow, {name}', 'Deep in it, {name}', 'Keep building, {name}'],
  afternoon_clear: ['Sunny momentum, {name}', 'Bright grind, {name}'],
  afternoon_rain: ['Perfect indoor hours, {name}', 'Rainy deep work, {name}'],
  afternoon_snow: ['Snowy deep work, {name}', 'Winter grind, {name}'],
  afternoon_storm: ['Storm-fueled focus, {name}'],
  afternoon_hot: ['Too hot outside, {name}', 'Indoor mode, {name}'],

  evening: ['Evening stretch, {name}', 'Sunset session, {name}', 'Winding down, {name}'],
  evening_clear: ['Golden hour glow, {name}', 'Clear sunset, {name}'],
  evening_rain: ['Cozy evening, {name}', 'Rainy wind-down, {name}'],
  evening_snow: ['Snowy evening, {name}'],

  night: ['Night mode on, {name}', 'Late shift energy, {name}', 'Nightcap session, {name}'],
  night_clear: ['Starlit session, {name}', 'Moonrise mode, {name}'],
  night_rain: ['Night rain focus, {name}', 'Cozy night in, {name}'],
  night_storm: ['Thunder night, {name}', 'Storm watching, {name}?'],
};

// ─────────────── Spanish (es) ─────────────────────────────────────
const es: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],
  latenight_clear: ['Sesión bajo la luna, {name}', 'Bajo las estrellas, {name}'],
  latenight_rain: ['Lluvia de medianoche, {name}'],
  latenight_storm: ['Tormenta y concentración, {name}'],
  latenight_snow: ['Nieve de medianoche, {name}'],
  latenight_fog: ['Medianoche de niebla, {name}'],

  dawn: ['{name}, madrugando', EASTER_EGG, 'Amaneciendo, {name}', 'Patrulla del alba, {name}'],
  dawn_clear: ['Persiguiendo el amanecer, {name}', 'Alba dorada, {name}'],
  dawn_rain: ['Amanecer lluvioso, {name}'],
  dawn_fog: ['Amanecer con niebla, {name}'],
  dawn_snow: ['Amanecer nevado, {name}'],

  morning: ['Impulso fresco, {name}', '¡A construir, {name}!', 'Energía matutina, {name}'],
  morning_clear: ['Día soleado, {name}', 'Cielos despejados, {name}'],
  morning_cloudy: ['Nublado pero con energía, {name}'],
  morning_rain: ['Clima de oficina, {name}', 'Lluvia y café, {name}'],
  morning_snow: ['Día de nieve, {name}', 'Nevando afuera, {name}'],
  morning_storm: ['Tormenta y productividad, {name}'],
  morning_hot: ['Mañana calurosa, {name}', 'Qué calor, {name}'],
  morning_fog: ['Mañana con niebla, {name}'],
  morning_freezing: ['Mañana helada, {name}'],

  afternoon: ['Tarde productiva, {name}', '{name}, dale que dale', 'Flujo de tarde, {name}'],
  afternoon_clear: ['Tarde soleada, {name}'],
  afternoon_rain: ['Horas de interior, {name}', 'Tarde lluviosa, {name}'],
  afternoon_snow: ['Nieve y trabajo, {name}'],
  afternoon_storm: ['Tormenta de tarde, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}', 'Cerrando el día, {name}'],
  evening_clear: ['Atardecer dorado, {name}'],
  evening_rain: ['Atardecer lluvioso, {name}'],
  evening_snow: ['Nieve al atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}', 'Turno de noche, {name}'],
  night_clear: ['Noche estrellada, {name}'],
  night_rain: ['Noche de lluvia, {name}'],
  night_storm: ['Tormenta nocturna, {name}'],
};

// ─────────────── Spanish — Argentina (es_AR) ─────────────────────
const es_AR: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando mal', 'Energía nocturna, {name}'],
  latenight_clear: ['Noche de luna, {name}'],
  latenight_rain: ['Lluvia de madrugada, {name}'],
  latenight_storm: ['Tormenta y mate, {name}'],

  dawn: [
    '{name}, madrugando como campeón',
    EASTER_EGG,
    '¡Arriba, {name}!',
    'Patrulla del alba, {name}',
  ],
  dawn_clear: ['Amanecer dorado, {name}', 'Salió el sol, {name}'],
  dawn_rain: ['Amanece lloviendo, {name}'],
  dawn_fog: ['Amanecer con neblina, {name}'],

  morning: [
    'Dale con todo, {name}',
    '¡Vamos, {name}!',
    'Arrancamos, {name}',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día espectacular, {name}', 'Cielo despejado, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con pilas, {name}'],
  morning_rain: [
    'Día de mate y laburo, {name}',
    'Lluvia y concentración, {name}',
    'Clima de escritorio, {name}',
  ],
  morning_snow: ['Nevando afuera, {name}', 'Día de nieve, {name}'],
  morning_storm: ['Tormenta y productividad, {name}'],
  morning_hot: ['Qué calor, {name}', 'Mañana calurosa, {name}'],
  morning_fog: ['Mañana con niebla, {name}'],
  morning_freezing: ['Está helando, {name}', 'Abrigate y dale, {name}'],

  afternoon: [
    'Metele pata, {name}',
    '{name}, dale que dale',
    'Tarde productiva, {name}',
    'Seguimos, {name}',
  ],
  afternoon_clear: ['Tarde soleada, {name}', 'Lindo para laburar, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}', 'Perfecto para el escritorio, {name}'],
  afternoon_snow: ['Nieve y laburo, {name}'],
  afternoon_storm: ['Tormenta de tarde, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}', 'Quedarse adentro, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}', 'Cerrando el día, {name}'],
  evening_clear: ['Atardecer espectacular, {name}'],
  evening_rain: ['Atardecer lluvioso, {name}'],
  evening_snow: ['Nieve al atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}', 'Turno noche, {name}'],
  night_clear: ['Noche estrellada, {name}'],
  night_rain: ['Noche de lluvia, {name}'],
  night_storm: ['Tormenta nocturna, {name}'],
};

// ─────────────── Spanish — Mexico (es_MX) ────────────────────────
const es_MX: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, desvelándose', 'Energía nocturna, {name}'],
  latenight_clear: ['Noche de luna, {name}'],
  latenight_rain: ['Lluvia de madrugada, {name}'],
  latenight_storm: ['Tormenta y café, {name}'],

  dawn: ['{name}, madrugando chido', EASTER_EGG, '¡Órale, {name}!', 'Amanecer, {name}'],
  dawn_clear: ['Amanecer dorado, {name}'],
  dawn_rain: ['Amanece lloviendo, {name}'],

  morning: [
    '¡Échale ganas, {name}!',
    '¡Ándale, {name}!',
    '¡A darle, {name}!',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día chido, {name}', 'Cielo despejado, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con ganas, {name}'],
  morning_rain: ['Día de café y chamba, {name}', 'Lluvia y concentración, {name}'],
  morning_snow: ['Nevando afuera, {name}'],
  morning_storm: ['Tormenta y productividad, {name}'],
  morning_hot: ['Qué calor, {name}', 'Mañana calurosa, {name}'],
  morning_fog: ['Mañana con neblina, {name}'],
  morning_freezing: ['Está helando, {name}'],

  afternoon: [
    '¡Dale, {name}!',
    '{name}, a seguirle',
    'Tarde productiva, {name}',
    'Seguimos, {name}',
  ],
  afternoon_clear: ['Tarde soleada, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}', 'Cerrando el día, {name}'],
  evening_clear: ['Atardecer chido, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}', 'Turno noche, {name}'],
  night_clear: ['Noche estrellada, {name}'],
  night_rain: ['Noche lluviosa, {name}'],
};

// ─────────────── Spanish — Colombia (es_CO) ──────────────────────
const es_CO: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],
  latenight_clear: ['Noche de luna, {name}'],

  dawn: ['{name}, madrugando con berraquera', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: [
    '¡Con toda, {name}!',
    '¡Pilas, {name}!',
    'Dale con ganas, {name}',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día bacano, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con pilas, {name}'],
  morning_rain: ['Día de tinto y trabajo, {name}', 'Lluvia y concentración, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_freezing: ['Mañana fría, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos con toda', 'Tarde productiva, {name}'],
  afternoon_clear: ['Tarde soleada, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}'],
  afternoon_hot: ['Mucho calor, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}', 'Cerrando el día, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
  night_clear: ['Noche estrellada, {name}'],
};

// ─────────────── Spanish — Chile (es_CL) ─────────────────────────
const es_CL: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando po', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: [
    '¡Dale con todo, {name}!',
    '¡Vamos, {name}!',
    'A ponerle weno, {name}',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día la raja, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero firme, {name}'],
  morning_rain: ['Día de café y pega, {name}', 'Lluvia y concentración, {name}'],
  morning_snow: ['Nevando afuera, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_freezing: ['Está pelando el frío, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos firme', 'Tarde productiva, {name}'],
  afternoon_clear: ['Tarde soleada, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}', 'Cerrando el día, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Peru (es_PE) ──────────────────────────
const es_PE: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando causa', EASTER_EGG, '¡Arriba, {name}!'],

  morning: [
    '¡Dale nomás, {name}!',
    '¡Vamos, {name}!',
    '¡Fuerza, {name}!',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día chévere, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de café y chamba, {name}'],
  morning_hot: ['Qué calor, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos firme', 'Tarde productiva, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Venezuela (es_VE) ─────────────────────
const es_VE: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, desvelado', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando pana', EASTER_EGG, '¡Arriba, {name}!'],

  morning: [
    '¡Échale pichón, {name}!',
    '¡Dale, {name}!',
    '¡Vamos, {name}!',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día chévere, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de café y trabajo, {name}'],
  morning_hot: ['Qué calor, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Uruguay (es_UY) ───────────────────────
const es_UY: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando bo', EASTER_EGG, '¡Arriba, {name}!'],

  morning: [
    '¡Dale con todo, {name}!',
    '¡Vamos, {name}!',
    'Arrancamos, {name}',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día bárbaro, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de mate y laburo, {name}', 'Lluvia y concentración, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_freezing: ['Está helando, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Ecuador (es_EC) ───────────────────────
const es_EC: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],
  latenight_clear: ['Noche de luna, {name}'],

  dawn: ['{name}, madrugando loco', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: [
    '¡Dale con ganas, {name}!',
    '¡Vamos, {name}!',
    'A chambear, {name}',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día chévere, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con pilas, {name}'],
  morning_rain: ['Día de café y chamba, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_freezing: ['Mañana helada, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_clear: ['Tarde soleada, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}'],
  afternoon_hot: ['Mucho calor, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
  night_clear: ['Noche estrellada, {name}'],
};

// ─────────────── Spanish — Dominican Republic (es_DO) ────────────
const es_DO: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando klok', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: [
    '¡Dímelo, {name}!',
    '¡Dale ahí, {name}!',
    '¡Vamos, {name}!',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día brutal, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con to, {name}'],
  morning_rain: ['Día de café y trabajo, {name}'],
  morning_hot: ['Qué calor, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Puerto Rico (es_PR) ───────────────────
const es_PR: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando brutal', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: ['¡Wepa, {name}!', '¡Dale, {name}!', '¡Vamos, {name}!', 'Impulso matutino, {name}'],
  morning_clear: ['Día brutal, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de café y trabajo, {name}'],
  morning_hot: ['Qué calor, {name}', 'Mañana caliente, {name}'],
  morning_storm: ['Tormenta y productividad, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Paraguay (es_PY) ──────────────────────
const es_PY: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando nde raʼe', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: ['¡Dale, {name}!', '¡Vamos, {name}!', 'A laburar, {name}', 'Impulso matutino, {name}'],
  morning_clear: ['Día lindo, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de tereré y laburo, {name}', 'Lluvia y concentración, {name}'],
  morning_hot: ['Qué calor, {name}', 'Mañana calurosa, {name}'],
  morning_freezing: ['Está helando, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Bolivia (es_BO) ───────────────────────
const es_BO: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando nomás', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: [
    '¡Dale nomás, {name}!',
    '¡Vamos, {name}!',
    '¡Fuerza, {name}!',
    'Impulso matutino, {name}',
  ],
  morning_clear: ['Día lindo, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de café y trabajo, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_freezing: ['Mañana fría, {name}', 'Está helando, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos nomás', 'Tarde productiva, {name}'],
  afternoon_hot: ['Mucho calor, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — Costa Rica (es_CR) ────────────────────
const es_CR: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando pura vida', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: ['¡Pura vida, {name}!', '¡Vamos, {name}!', '¡Dale, {name}!', 'Impulso matutino, {name}'],
  morning_clear: ['Día tuanis, {name}', 'Mañana soleada, {name}'],
  morning_cloudy: ['Nublado pero con ganas, {name}'],
  morning_rain: ['Día de café y chamba, {name}', 'Lluvia y concentración, {name}'],
  morning_hot: ['Qué calor, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_rain: ['Tarde lluviosa, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Spanish — El Salvador (es_SV) ───────────────────
const es_SV: PhrasePool = {
  latenight: ['Modo búho, {name}', '{name}, trasnochando', 'Energía nocturna, {name}'],

  dawn: ['{name}, madrugando cipote', EASTER_EGG, '¡Arriba, {name}!'],
  dawn_clear: ['Amanecer dorado, {name}'],

  morning: ['¡Órale, {name}!', '¡Dale, {name}!', '¡Vamos, {name}!', 'Impulso matutino, {name}'],
  morning_clear: ['Día chivo, {name}', 'Mañana soleada, {name}'],
  morning_rain: ['Día de café y chamba, {name}'],
  morning_hot: ['Qué calor, {name}'],
  morning_storm: ['Tormenta y productividad, {name}'],

  afternoon: ['¡Dale, {name}!', '{name}, seguimos', 'Tarde productiva, {name}'],
  afternoon_hot: ['Mucho calor afuera, {name}'],

  evening: ['Hora dorada, {name}', 'Atardecer, {name}'],

  night: ['Modo nocturno, {name}', 'Sesión nocturna, {name}'],
};

// ─────────────── Portuguese (pt) ──────────────────────────────────
const pt: PhrasePool = {
  latenight: ['Modo coruja, {name}', '{name}, varando a noite', 'Energia da meia-noite, {name}'],
  latenight_clear: ['Sessão ao luar, {name}', 'Sob as estrelas, {name}'],
  latenight_rain: ['Chuva da madrugada, {name}'],
  latenight_storm: ['Tempestade e foco, {name}'],
  latenight_snow: ['Neve da meia-noite, {name}'],

  dawn: ['{name}, madrugando', EASTER_EGG, 'Amanhecendo, {name}', 'Patrulha da aurora, {name}'],
  dawn_clear: ['Amanhecer dourado, {name}', 'Nasceu o sol, {name}'],
  dawn_rain: ['Amanhece chovendo, {name}'],
  dawn_fog: ['Amanhecer com neblina, {name}'],

  morning: ['Impulso fresco, {name}', 'Bora, {name}!', 'Energia matinal, {name}'],
  morning_clear: ['Dia ensolarado, {name}', 'Céu limpo, {name}'],
  morning_cloudy: ['Nublado mas com energia, {name}'],
  morning_rain: ['Clima de escritório, {name}', 'Chuva e café, {name}'],
  morning_snow: ['Nevando lá fora, {name}'],
  morning_storm: ['Tempestade e produtividade, {name}'],
  morning_hot: ['Que calor, {name}', 'Manhã quente, {name}'],
  morning_fog: ['Manhã com neblina, {name}'],
  morning_freezing: ['Tá gelando, {name}'],

  afternoon: ['Tarde produtiva, {name}', '{name}, seguindo em frente', 'Fluxo da tarde, {name}'],
  afternoon_clear: ['Tarde ensolarada, {name}'],
  afternoon_rain: ['Horas de interior, {name}', 'Tarde chuvosa, {name}'],
  afternoon_snow: ['Neve e trabalho, {name}'],
  afternoon_storm: ['Tempestade de tarde, {name}'],
  afternoon_hot: ['Calor demais lá fora, {name}'],

  evening: ['Hora dourada, {name}', 'Entardecer, {name}', 'Encerrando o dia, {name}'],
  evening_clear: ['Entardecer dourado, {name}'],
  evening_rain: ['Noitinha chuvosa, {name}'],

  night: ['Modo noturno, {name}', 'Sessão noturna, {name}'],
  night_clear: ['Noite estrelada, {name}'],
  night_rain: ['Noite de chuva, {name}'],
  night_storm: ['Tempestade noturna, {name}'],
};

// ─────────────── French (fr) ──────────────────────────────────────
const fr: PhrasePool = {
  latenight: ['Mode hibou, {name}', '{name}, nuit blanche', 'Énergie nocturne, {name}'],
  latenight_clear: ['Clair de lune, {name}', 'Sous les étoiles, {name}'],
  latenight_rain: ['Pluie de minuit, {name}'],
  latenight_storm: ['Tonnerre et focus, {name}'],
  latenight_snow: ['Neige de minuit, {name}'],

  dawn: [
    '{name}, debout tôt',
    EASTER_EGG,
    "L'aube se lève, {name}",
    "Patrouille de l'aube, {name}",
  ],
  dawn_clear: ['Aube dorée, {name}', 'Lever de soleil, {name}'],
  dawn_rain: ['Aube pluvieuse, {name}'],
  dawn_fog: ['Aube brumeuse, {name}'],

  morning: ['Élan matinal, {name}', "C'est parti, {name}!", 'Énergie du matin, {name}'],
  morning_clear: ['Ciel dégagé, {name}', 'Journée radieuse, {name}'],
  morning_cloudy: ['Nuageux mais motivé, {name}'],
  morning_rain: ['Temps de bureau, {name}', 'Pluie et café, {name}'],
  morning_snow: ['Il neige dehors, {name}'],
  morning_storm: ['Orage et productivité, {name}'],
  morning_hot: ['Quelle chaleur, {name}'],
  morning_fog: ['Matin brumeux, {name}'],
  morning_freezing: ['Il gèle dehors, {name}'],

  afternoon: [
    'Après-midi productif, {name}',
    '{name}, on continue',
    "Flow de l'après-midi, {name}",
  ],
  afternoon_clear: ['Après-midi ensoleillé, {name}'],
  afternoon_rain: ["Heures d'intérieur, {name}"],
  afternoon_snow: ['Neige et travail, {name}'],
  afternoon_storm: ["Orage d'après-midi, {name}"],
  afternoon_hot: ['Trop chaud dehors, {name}'],

  evening: ['Heure dorée, {name}', 'Crépuscule, {name}', 'Fin de journée, {name}'],
  evening_clear: ['Coucher de soleil doré, {name}'],
  evening_rain: ['Soirée pluvieuse, {name}'],

  night: ['Mode nuit, {name}', 'Session nocturne, {name}'],
  night_clear: ['Nuit étoilée, {name}'],
  night_rain: ['Nuit de pluie, {name}'],
  night_storm: ['Orage nocturne, {name}'],
};

// ─────────────── German (de) ──────────────────────────────────────
const de: PhrasePool = {
  latenight: ['Nachteulenmodus, {name}', '{name}, Nachtschicht', 'Mitternachtsenergie, {name}'],
  latenight_clear: ['Mondscheinsession, {name}', 'Unter den Sternen, {name}'],
  latenight_rain: ['Mitternachtsregen, {name}'],
  latenight_storm: ['Donner & Fokus, {name}'],
  latenight_snow: ['Frostige Mitternacht, {name}'],

  dawn: ['{name}, Frühaufsteher', EASTER_EGG, 'Morgendämmerung, {name}'],
  dawn_clear: ['Goldene Dämmerung, {name}', 'Sonnenaufgang, {name}'],
  dawn_rain: ['Regnerische Dämmerung, {name}'],
  dawn_fog: ['Neblige Dämmerung, {name}'],

  morning: ['Frischer Start, {name}', "Los geht's, {name}!", 'Morgenenergie, {name}'],
  morning_clear: ['Sonniger Tag, {name}', 'Klarer Himmel, {name}'],
  morning_cloudy: ['Bewölkt aber motiviert, {name}'],
  morning_rain: ['Schreibtischwetter, {name}', 'Regen & Kaffee, {name}'],
  morning_snow: ['Schneetag, {name}', 'Es schneit draußen, {name}'],
  morning_storm: ['Gewitter & Produktivität, {name}'],
  morning_hot: ['Schwüler Morgen, {name}'],
  morning_fog: ['Nebliger Morgen, {name}'],
  morning_freezing: ['Frostiger Start, {name}', 'Einpacken & loslegen, {name}'],

  afternoon: ['Produktiver Nachmittag, {name}', '{name}, weiter so', 'Nachmittagsflow, {name}'],
  afternoon_clear: ['Sonniger Nachmittag, {name}'],
  afternoon_rain: ['Perfekt für drinnen, {name}'],
  afternoon_snow: ['Schnee & Arbeit, {name}'],
  afternoon_storm: ['Nachmittagsgewitter, {name}'],
  afternoon_hot: ['Zu heiß draußen, {name}'],

  evening: ['Goldene Stunde, {name}', 'Feierabend, {name}', 'Abendsession, {name}'],
  evening_clear: ['Goldener Sonnenuntergang, {name}'],
  evening_rain: ['Regnerischer Abend, {name}'],

  night: ['Nachtmodus, {name}', 'Nachtsession, {name}', 'Spätschicht, {name}'],
  night_clear: ['Sternennacht, {name}'],
  night_rain: ['Regennacht, {name}'],
  night_storm: ['Gewitternacht, {name}'],
};

// ─────────────── Italian (it) ─────────────────────────────────────
const it: PhrasePool = {
  latenight: ['Modalità gufo, {name}', '{name}, nottambulo', 'Energia di mezzanotte, {name}'],
  latenight_clear: ['Sessione al chiaro di luna, {name}', 'Sotto le stelle, {name}'],
  latenight_rain: ['Pioggia di mezzanotte, {name}'],
  latenight_storm: ['Tuono e focus, {name}'],

  dawn: ['{name}, alzato presto', EASTER_EGG, 'Alba dorata, {name}'],
  dawn_clear: ["Inseguendo l'alba, {name}", 'Alba luminosa, {name}'],
  dawn_rain: ['Alba piovosa, {name}'],
  dawn_fog: ['Alba nebbiosa, {name}'],

  morning: ['Slancio mattutino, {name}', 'Si parte, {name}!', 'Energia mattutina, {name}'],
  morning_clear: ['Giornata soleggiata, {name}', 'Cielo sereno, {name}'],
  morning_cloudy: ['Nuvoloso ma carico, {name}'],
  morning_rain: ['Tempo da ufficio, {name}', 'Pioggia e caffè, {name}'],
  morning_snow: ['Nevica fuori, {name}'],
  morning_storm: ['Temporale e produttività, {name}'],
  morning_hot: ['Che caldo, {name}'],
  morning_fog: ['Mattina nebbiosa, {name}'],
  morning_freezing: ['Si gela fuori, {name}'],

  afternoon: ['Pomeriggio produttivo, {name}', '{name}, avanti così', 'Flow pomeridiano, {name}'],
  afternoon_clear: ['Pomeriggio soleggiato, {name}'],
  afternoon_rain: ['Ore da interni, {name}'],
  afternoon_storm: ['Temporale pomeridiano, {name}'],
  afternoon_hot: ['Troppo caldo fuori, {name}'],

  evening: ['Ora dorata, {name}', 'Tramonto, {name}', 'Chiusura giornata, {name}'],
  evening_clear: ['Tramonto dorato, {name}'],
  evening_rain: ['Serata piovosa, {name}'],

  night: ['Modalità notte, {name}', 'Sessione notturna, {name}'],
  night_clear: ['Notte stellata, {name}'],
  night_rain: ['Notte di pioggia, {name}'],
  night_storm: ['Temporale notturno, {name}'],
};

// ─────────────── Dutch (nl) ───────────────────────────────────────
const nl: PhrasePool = {
  latenight: ['Nachtuilmodus, {name}', '{name}, doorwerken', 'Middernachtenergie, {name}'],
  latenight_clear: ['Maanlichtsessie, {name}'],
  latenight_rain: ['Middernachtregen, {name}'],
  latenight_storm: ['Onweer & focus, {name}'],

  dawn: ['{name}, vroege vogel', EASTER_EGG, 'Dageraad, {name}'],
  dawn_clear: ['Gouden dageraad, {name}', 'Zonsopkomst, {name}'],
  dawn_rain: ['Regenachtige dageraad, {name}'],
  dawn_fog: ['Mistige dageraad, {name}'],

  morning: ['Frisse start, {name}', 'Aan de slag, {name}!', 'Ochtendenergie, {name}'],
  morning_clear: ['Zonnige dag, {name}', 'Blauwe lucht, {name}'],
  morning_cloudy: ['Bewolkt maar gemotiveerd, {name}'],
  morning_rain: ['Bureauweertje, {name}', 'Regen & koffie, {name}'],
  morning_snow: ['Het sneeuwt, {name}'],
  morning_storm: ['Onweer & productiviteit, {name}'],
  morning_hot: ['Warme ochtend, {name}'],
  morning_fog: ['Mistige ochtend, {name}'],
  morning_freezing: ['Het vriest, {name}'],

  afternoon: ['Productieve middag, {name}', '{name}, doorgaan', 'Middagflow, {name}'],
  afternoon_clear: ['Zonnige middag, {name}'],
  afternoon_rain: ['Middagregen, {name}', 'Perfect binnenweer, {name}'],
  afternoon_storm: ['Middagonweer, {name}'],
  afternoon_hot: ['Te warm buiten, {name}'],

  evening: ['Gouden uur, {name}', 'Schemering, {name}', 'Avondsessie, {name}'],
  evening_clear: ['Gouden zonsondergang, {name}'],
  evening_rain: ['Regenachtige avond, {name}'],

  night: ['Nachtmodus, {name}', 'Nachtsessie, {name}'],
  night_clear: ['Sterrennacht, {name}'],
  night_rain: ['Regennacht, {name}'],
  night_storm: ['Onweersnacht, {name}'],
};

// ─────────────── Turkish (tr) ─────────────────────────────────────
const tr: PhrasePool = {
  latenight: ['Gece kuşu modu, {name}', '{name}, gece mesaisi', 'Gece enerjisi, {name}'],
  latenight_clear: ['Mehtap oturumu, {name}'],
  latenight_rain: ['Gece yağmuru, {name}'],
  latenight_storm: ['Gök gürültüsü ve odak, {name}'],

  dawn: ['{name}, erken kalkan', EASTER_EGG, 'Şafak, {name}'],
  dawn_clear: ['Altın şafak, {name}', 'Gün doğumu, {name}'],
  dawn_rain: ['Yağmurlu şafak, {name}'],
  dawn_fog: ['Sisli şafak, {name}'],

  morning: ['Taze başlangıç, {name}', 'Haydi, {name}!', 'Sabah enerjisi, {name}'],
  morning_clear: ['Güneşli gün, {name}', 'Açık gökyüzü, {name}'],
  morning_cloudy: ['Bulutlu ama enerjik, {name}'],
  morning_rain: ['Masa başı havası, {name}', 'Yağmur ve kahve, {name}'],
  morning_snow: ['Kar yağıyor, {name}'],
  morning_storm: ['Fırtına ve verimlilik, {name}'],
  morning_hot: ['Sıcak sabah, {name}'],
  morning_fog: ['Sisli sabah, {name}'],
  morning_freezing: ['Dondurucu sabah, {name}'],

  afternoon: ['Verimli öğleden sonra, {name}', '{name}, devam', 'Öğleden sonra akışı, {name}'],
  afternoon_clear: ['Güneşli öğleden sonra, {name}'],
  afternoon_rain: ['İç mekan saatleri, {name}'],
  afternoon_storm: ['Öğleden sonra fırtınası, {name}'],
  afternoon_hot: ['Dışarısı çok sıcak, {name}'],

  evening: ['Altın saat, {name}', 'Gün batımı, {name}'],
  evening_clear: ['Altın gün batımı, {name}'],
  evening_rain: ['Yağmurlu akşam, {name}'],

  night: ['Gece modu, {name}', 'Gece oturumu, {name}'],
  night_clear: ['Yıldızlı gece, {name}'],
  night_rain: ['Yağmurlu gece, {name}'],
  night_storm: ['Fırtınalı gece, {name}'],
};

// ─────────────── Japanese (ja) — name FIRST ───────────────────────
const ja: PhrasePool = {
  latenight: ['{name}、夜更かしモード', '{name}、深夜の集中', '{name}、ミッドナイト'],
  latenight_clear: ['{name}、月夜のセッション', '{name}、星の下で'],
  latenight_rain: ['{name}、深夜の雨音', '{name}、真夜中の雨'],
  latenight_storm: ['{name}、雷と集中'],
  latenight_snow: ['{name}、真夜中の雪'],

  dawn: ['{name}、早起きは三文の徳', '{name}、夜明け前'],
  dawn_clear: ['{name}、朝焼けを追って', '{name}、黄金の夜明け'],
  dawn_rain: ['{name}、雨の夜明け'],
  dawn_fog: ['{name}、霧の夜明け'],

  morning: ['{name}、フレッシュスタート', '{name}、さあ始めよう', '{name}、朝の勢い'],
  morning_clear: ['{name}、快晴の朝', '{name}、青空スタート'],
  morning_cloudy: ['{name}、曇りでも全力'],
  morning_rain: ['{name}、雨の日は集中日', '{name}、雨音と仕事'],
  morning_snow: ['{name}、雪の朝', '{name}、雪景色スタート'],
  morning_storm: ['{name}、嵐と生産性'],
  morning_hot: ['{name}、暑い朝', '{name}、猛暑の朝'],
  morning_fog: ['{name}、霧の朝'],
  morning_freezing: ['{name}、凍える朝'],

  afternoon: ['{name}、午後の集中', '{name}、この調子で', '{name}、フロー状態'],
  afternoon_clear: ['{name}、晴れた午後'],
  afternoon_rain: ['{name}、室内日和'],
  afternoon_snow: ['{name}、雪と仕事'],
  afternoon_storm: ['{name}、午後の嵐'],
  afternoon_hot: ['{name}、外は暑すぎ'],

  evening: ['{name}、ゴールデンアワー', '{name}、黄昏どき', '{name}、夕焼けタイム'],
  evening_clear: ['{name}、黄金の夕暮れ'],
  evening_rain: ['{name}、雨の夕暮れ'],

  night: ['{name}、ナイトモード', '{name}、夜の作業', '{name}、深夜セッション'],
  night_clear: ['{name}、星空の下で'],
  night_rain: ['{name}、雨の夜'],
  night_storm: ['{name}、嵐の夜'],
};

// ─────────────── Korean (ko) — name FIRST ─────────────────────────
const ko: PhrasePool = {
  latenight: ['{name}, 올빼미 모드', '{name}, 야간 집중', '{name}, 한밤의 에너지'],
  latenight_clear: ['{name}, 달빛 세션'],
  latenight_rain: ['{name}, 한밤의 빗소리'],
  latenight_storm: ['{name}, 천둥과 집중'],

  dawn: ['{name}, 새벽의 첫 주자', '{name}, 새벽빛'],
  dawn_clear: ['{name}, 황금빛 새벽', '{name}, 일출을 향해'],
  dawn_rain: ['{name}, 비 오는 새벽'],
  dawn_fog: ['{name}, 안개 낀 새벽'],

  morning: ['{name}, 상쾌한 시작', '{name}, 시작해볼까', '{name}, 아침의 기운'],
  morning_clear: ['{name}, 맑은 하늘', '{name}, 화창한 하루'],
  morning_cloudy: ['{name}, 흐려도 의욕 만점'],
  morning_rain: ['{name}, 비 오는 날 집중', '{name}, 빗소리와 함께'],
  morning_snow: ['{name}, 눈 오는 아침'],
  morning_storm: ['{name}, 폭풍과 생산성'],
  morning_hot: ['{name}, 더운 아침'],
  morning_fog: ['{name}, 안개 낀 아침'],
  morning_freezing: ['{name}, 얼어붙는 아침'],

  afternoon: ['{name}, 오후의 몰입', '{name}, 이 기세로', '{name}, 오후 플로우'],
  afternoon_clear: ['{name}, 맑은 오후'],
  afternoon_rain: ['{name}, 실내 시간'],
  afternoon_storm: ['{name}, 오후의 폭풍'],
  afternoon_hot: ['{name}, 밖은 너무 더워'],

  evening: ['{name}, 노을빛 타임', '{name}, 저녁 무렵'],
  evening_clear: ['{name}, 황금빛 노을'],
  evening_rain: ['{name}, 비 오는 저녁'],

  night: ['{name}, 나이트 모드', '{name}, 밤의 작업'],
  night_clear: ['{name}, 별빛 세션'],
  night_rain: ['{name}, 비 오는 밤'],
  night_storm: ['{name}, 폭풍의 밤'],
};

// ─────────────── Chinese (zh) — name FIRST ────────────────────────
const zh: PhrasePool = {
  latenight: ['{name}，夜猫子模式', '{name}，深夜冲刺', '{name}，午夜能量'],
  latenight_clear: ['{name}，月光下的专注'],
  latenight_rain: ['{name}，午夜的雨声'],
  latenight_storm: ['{name}，雷声与专注'],

  dawn: ['{name}，早起的鸟儿有虫吃', '{name}，拂晓时分'],
  dawn_clear: ['{name}，金色黎明', '{name}，追逐日出'],
  dawn_rain: ['{name}，雨中破晓'],
  dawn_fog: ['{name}，雾中破晓'],

  morning: ['{name}，新的一天', '{name}，开始吧', '{name}，朝气蓬勃'],
  morning_clear: ['{name}，晴空万里', '{name}，阳光正好'],
  morning_cloudy: ['{name}，多云但有劲'],
  morning_rain: ['{name}，雨天最宜专注', '{name}，听雨办公'],
  morning_snow: ['{name}，外面下雪了', '{name}，雪中奋斗'],
  morning_storm: ['{name}，风暴与效率'],
  morning_hot: ['{name}，早晨就很热'],
  morning_fog: ['{name}，雾蒙蒙的早晨'],
  morning_freezing: ['{name}，冻人的早晨'],

  afternoon: ['{name}，午后专注', '{name}，继续加油', '{name}，下午心流'],
  afternoon_clear: ['{name}，晴朗的午后'],
  afternoon_rain: ['{name}，室内时光'],
  afternoon_storm: ['{name}，午后暴风雨'],
  afternoon_hot: ['{name}，外面太热了'],

  evening: ['{name}，日落时分', '{name}，黄昏之际'],
  evening_clear: ['{name}，金色黄昏'],
  evening_rain: ['{name}，雨中黄昏'],

  night: ['{name}，夜间模式', '{name}，深夜时光'],
  night_clear: ['{name}，星空之下'],
  night_rain: ['{name}，雨夜时分'],
  night_storm: ['{name}，暴风雨之夜'],
};

// ─────────────── Hindi (hi) — name FIRST ──────────────────────────
const hi: PhrasePool = {
  latenight: ['{name}, रात का उल्लू मोड', '{name}, आधी रात की ऊर्जा'],
  latenight_clear: ['{name}, चाँदनी रात'],
  latenight_rain: ['{name}, आधी रात की बारिश'],
  latenight_storm: ['{name}, तूफ़ान और ध्यान'],

  dawn: ['{name}, सवेरे का सितारा', '{name}, पहली किरण'],
  dawn_clear: ['{name}, सुनहरी सुबह', '{name}, उगता सूरज'],
  dawn_rain: ['{name}, बारिश में सवेरा'],
  dawn_fog: ['{name}, धुंध भरी सुबह'],

  morning: ['{name}, ताज़ा शुरुआत', '{name}, चलो शुरू करें', '{name}, सुबह की ऊर्जा'],
  morning_clear: ['{name}, धूप भरा दिन', '{name}, साफ़ आसमान'],
  morning_cloudy: ['{name}, बादल लेकिन जोश'],
  morning_rain: ['{name}, बारिश और काम', '{name}, बारिश का मौसम'],
  morning_snow: ['{name}, बर्फ़ की सुबह'],
  morning_storm: ['{name}, तूफ़ान और उत्पादकता'],
  morning_hot: ['{name}, गरम सुबह'],
  morning_fog: ['{name}, कोहरे की सुबह'],
  morning_freezing: ['{name}, ठंड से जमा देने वाली सुबह'],

  afternoon: ['{name}, दोपहर की लहर', '{name}, जारी रखो'],
  afternoon_clear: ['{name}, धूप भरी दोपहर'],
  afternoon_rain: ['{name}, अंदर का समय'],
  afternoon_storm: ['{name}, दोपहर का तूफ़ान'],
  afternoon_hot: ['{name}, बाहर बहुत गर्मी'],

  evening: ['{name}, सुनहरी शाम', '{name}, सूर्यास्त'],
  evening_clear: ['{name}, सुनहरा सूर्यास्त'],
  evening_rain: ['{name}, बारिश की शाम'],

  night: ['{name}, नाइट मोड', '{name}, रात की शिफ्ट'],
  night_clear: ['{name}, तारों भरी रात'],
  night_rain: ['{name}, बारिश की रात'],
  night_storm: ['{name}, तूफ़ानी रात'],
};

// ─────────────── Urdu (ur) — name FIRST (RTL) ────────────────────
const ur: PhrasePool = {
  latenight: ['{name}، رات کا الّو موڈ', '{name}، آدھی رات کی توانائی'],
  latenight_clear: ['{name}، چاندنی رات'],
  latenight_rain: ['{name}، آدھی رات کی بارش'],
  latenight_storm: ['{name}، طوفان اور توجہ'],

  dawn: ['{name}، صبح کا ستارہ', '{name}، پہلی کرن'],
  dawn_clear: ['{name}، سنہری صبح', '{name}، طلوع آفتاب'],
  dawn_rain: ['{name}، بارش میں صبح'],
  dawn_fog: ['{name}، دھند بھری صبح'],

  morning: ['{name}، تازہ شروعات', '{name}، چلو شروع کریں', '{name}، صبح کی توانائی'],
  morning_clear: ['{name}، دھوپ بھرا دن', '{name}، صاف آسمان'],
  morning_cloudy: ['{name}، بادل لیکن جوش'],
  morning_rain: ['{name}، بارش اور کام', '{name}، بارش کا موسم'],
  morning_snow: ['{name}، برف کی صبح'],
  morning_storm: ['{name}، طوفان اور پیداواری'],
  morning_hot: ['{name}، گرم صبح'],
  morning_fog: ['{name}، کہرے کی صبح'],
  morning_freezing: ['{name}، ٹھنڈ سے جمانے والی صبح'],

  afternoon: ['{name}، دوپہر کی لہر', '{name}، جاری رکھو'],
  afternoon_clear: ['{name}، دھوپ بھری دوپہر'],
  afternoon_rain: ['{name}، اندر کا وقت'],
  afternoon_storm: ['{name}، دوپہر کا طوفان'],
  afternoon_hot: ['{name}، باہر بہت گرمی'],

  evening: ['{name}، سنہری شام', '{name}، غروب آفتاب'],
  evening_clear: ['{name}، سنہرا غروب'],
  evening_rain: ['{name}، بارش کی شام'],

  night: ['{name}، نائٹ موڈ', '{name}، رات کی شفٹ'],
  night_clear: ['{name}، تاروں بھری رات'],
  night_rain: ['{name}، بارش کی رات'],
  night_storm: ['{name}، طوفانی رات'],
};

// ─────────────── Bengali (bn) — name FIRST ────────────────────────
const bn: PhrasePool = {
  latenight: ['{name}, রাতের পেঁচা মোড', '{name}, মধ্যরাতের শক্তি'],
  latenight_clear: ['{name}, জ্যোৎস্না রাত'],
  latenight_rain: ['{name}, মধ্যরাতের বৃষ্টি'],
  latenight_storm: ['{name}, বজ্রপাত আর মনোযোগ'],

  dawn: ['{name}, ভোরের পাখি', '{name}, প্রথম আলো'],
  dawn_clear: ['{name}, সোনালি ভোর', '{name}, সূর্যোদয়'],
  dawn_rain: ['{name}, বৃষ্টিতে ভোর'],
  dawn_fog: ['{name}, কুয়াশার ভোর'],

  morning: ['{name}, তাজা শুরু', '{name}, চলো শুরু করি', '{name}, সকালের শক্তি'],
  morning_clear: ['{name}, রোদ্দুর দিন', '{name}, পরিষ্কার আকাশ'],
  morning_cloudy: ['{name}, মেঘলা কিন্তু উৎসাহী'],
  morning_rain: ['{name}, বৃষ্টি আর কাজ', '{name}, বৃষ্টির আবহাওয়া'],
  morning_snow: ['{name}, তুষারের সকাল'],
  morning_storm: ['{name}, ঝড় আর উৎপাদনশীলতা'],
  morning_hot: ['{name}, গরম সকাল'],
  morning_fog: ['{name}, কুয়াশার সকাল'],
  morning_freezing: ['{name}, হাড় কাঁপানো ঠান্ডা'],

  afternoon: ['{name}, দুপুরের ঢেউ', '{name}, চালিয়ে যাও'],
  afternoon_clear: ['{name}, রোদ্দুর দুপুর'],
  afternoon_rain: ['{name}, ঘরের সময়'],
  afternoon_storm: ['{name}, দুপুরের ঝড়'],
  afternoon_hot: ['{name}, বাইরে খুব গরম'],

  evening: ['{name}, সোনালি সন্ধ্যা', '{name}, সূর্যাস্ত'],
  evening_clear: ['{name}, সোনালি সূর্যাস্ত'],
  evening_rain: ['{name}, বৃষ্টির সন্ধ্যা'],

  night: ['{name}, নাইট মোড', '{name}, রাতের শিফট'],
  night_clear: ['{name}, তারা ভরা রাত'],
  night_rain: ['{name}, বৃষ্টির রাত'],
  night_storm: ['{name}, ঝড়ের রাত'],
};

// ─────────────── Vietnamese (vi) ──────────────────────────────────
const vi: PhrasePool = {
  latenight: ['Chế độ cú đêm, {name}', '{name}, năng lượng nửa đêm'],
  latenight_clear: ['Dưới ánh trăng, {name}'],
  latenight_rain: ['Mưa nửa đêm, {name}'],
  latenight_storm: ['Sấm và tập trung, {name}'],

  dawn: ['{name}, dậy sớm nhất', EASTER_EGG, 'Bình minh, {name}'],
  dawn_clear: ['Bình minh vàng, {name}', 'Mặt trời mọc, {name}'],
  dawn_rain: ['Bình minh mưa, {name}'],
  dawn_fog: ['Bình minh sương mù, {name}'],

  morning: ['Khởi đầu mới, {name}', 'Bắt đầu thôi, {name}!', 'Năng lượng buổi sáng, {name}'],
  morning_clear: ['Trời nắng đẹp, {name}', 'Bầu trời trong xanh, {name}'],
  morning_cloudy: ['Trời mây nhưng đầy năng lượng, {name}'],
  morning_rain: ['Thời tiết làm việc, {name}', 'Mưa và cà phê, {name}'],
  morning_snow: ['Tuyết rơi ngoài kia, {name}'],
  morning_storm: ['Bão và năng suất, {name}'],
  morning_hot: ['Sáng nóng quá, {name}'],
  morning_fog: ['Sáng sương mù, {name}'],
  morning_freezing: ['Sáng lạnh cóng, {name}'],

  afternoon: ['Chiều năng suất, {name}', 'Tiếp tục nào, {name}'],
  afternoon_clear: ['Chiều nắng đẹp, {name}'],
  afternoon_rain: ['Giờ trong nhà, {name}'],
  afternoon_storm: ['Bão chiều, {name}'],
  afternoon_hot: ['Ngoài trời nóng quá, {name}'],

  evening: ['Giờ vàng, {name}', 'Hoàng hôn, {name}'],
  evening_clear: ['Hoàng hôn vàng, {name}'],
  evening_rain: ['Chiều tối mưa, {name}'],

  night: ['Chế độ đêm, {name}', 'Phiên đêm, {name}'],
  night_clear: ['Đêm đầy sao, {name}'],
  night_rain: ['Đêm mưa, {name}'],
  night_storm: ['Đêm bão, {name}'],
};

// ─────────────── Indonesian (id) ──────────────────────────────────
const id_pool: PhrasePool = {
  latenight: ['Mode burung hantu, {name}', '{name}, energi tengah malam'],
  latenight_clear: ['Di bawah cahaya bulan, {name}'],
  latenight_rain: ['Hujan tengah malam, {name}'],
  latenight_storm: ['Petir dan fokus, {name}'],

  dawn: ['{name}, bangun paling awal', EASTER_EGG, 'Fajar menyingsing, {name}'],
  dawn_clear: ['Fajar keemasan, {name}', 'Matahari terbit, {name}'],
  dawn_rain: ['Fajar berhujan, {name}'],
  dawn_fog: ['Fajar berkabut, {name}'],

  morning: ['Awal yang segar, {name}', 'Mari mulai, {name}!', 'Energi pagi, {name}'],
  morning_clear: ['Hari yang cerah, {name}', 'Langit biru, {name}'],
  morning_cloudy: ['Mendung tapi semangat, {name}'],
  morning_rain: ['Cuaca kerja, {name}', 'Hujan dan kopi, {name}'],
  morning_snow: ['Salju di luar, {name}'],
  morning_storm: ['Badai dan produktivitas, {name}'],
  morning_hot: ['Pagi yang panas, {name}'],
  morning_fog: ['Pagi berkabut, {name}'],
  morning_freezing: ['Pagi yang membeku, {name}'],

  afternoon: ['Sore produktif, {name}', 'Lanjutkan, {name}'],
  afternoon_clear: ['Sore yang cerah, {name}'],
  afternoon_rain: ['Waktu di dalam, {name}'],
  afternoon_storm: ['Badai sore, {name}'],
  afternoon_hot: ['Di luar terlalu panas, {name}'],

  evening: ['Jam emas, {name}', 'Senja, {name}'],
  evening_clear: ['Senja keemasan, {name}'],
  evening_rain: ['Senja berhujan, {name}'],

  night: ['Mode malam, {name}', 'Sesi malam, {name}'],
  night_clear: ['Malam berbintang, {name}'],
  night_rain: ['Malam berhujan, {name}'],
  night_storm: ['Malam badai, {name}'],
};

// ─────────────── Yoruba (yo) ──────────────────────────────────────
const yo: PhrasePool = {
  latenight: ['{name}, aṣálẹ̀ gígùn', '{name}, agbára ọ̀gànjọ́'],
  latenight_clear: ['{name}, àkókò oṣùpá'],
  latenight_rain: ['{name}, òjò ọ̀gànjọ́'],

  dawn: ['{name}, àjílẹ̀ kùtùkùtù', EASTER_EGG, '{name}, ìmọ́lẹ̀ àkọ́kọ́'],
  dawn_clear: ['{name}, owúrọ̀ wúrà'],
  dawn_rain: ['{name}, òjò owúrọ̀ kùtùkùtù'],
  dawn_fog: ['{name}, ìkùukùu owúrọ̀'],

  morning: ['{name}, ẹ kú àárọ̀', '{name}, ẹ jẹ́ kí a bẹ̀rẹ̀', '{name}, agbára òwúrọ̀'],
  morning_clear: ['{name}, ọjọ́ oòrùn', '{name}, sánmà mọ́'],
  morning_cloudy: ['{name}, ọ̀run kúnlẹ̀ ṣùgbọ́n agbára wà'],
  morning_rain: ['{name}, ojú ọjọ́ iṣẹ́', '{name}, òjò àti iṣẹ́'],
  morning_storm: ['{name}, ìjì àti iṣẹ́'],
  morning_hot: ['{name}, owúrọ̀ gbígbóná'],
  morning_fog: ['{name}, owúrọ̀ ìkùukùu'],

  afternoon: ['{name}, ẹ kú ọ̀sán', '{name}, ẹ máa tẹ̀síwájú'],
  afternoon_clear: ['{name}, ọ̀sán oòrùn'],
  afternoon_rain: ['{name}, àkókò inú ilé'],
  afternoon_hot: ['{name}, ó gbóná jù lóde'],

  evening: ['{name}, ẹ kú ìrọ̀lẹ́', '{name}, àkókò wúrà'],
  evening_clear: ['{name}, ìrọ̀lẹ́ wúrà'],
  evening_rain: ['{name}, òjò ìrọ̀lẹ́'],

  night: ['{name}, ọ̀wọ́ alẹ́', '{name}, àkókò alẹ́'],
  night_clear: ['{name}, alẹ́ ìràwọ̀'],
  night_rain: ['{name}, òjò alẹ́'],
  night_storm: ['{name}, ìjì alẹ́'],
};

// ── Locale registry ───────────────────────────────────────────────

const LOCALE_POOLS: Record<string, PhrasePool> = {
  en,
  es,
  pt,
  fr,
  de,
  it,
  nl,
  tr,
  ja,
  ko,
  zh,
  hi,
  ur,
  bn,
  vi,
  id: id_pool,
  yo,
  // LATAM country-specific Spanish variants
  es_AR,
  es_MX,
  es_CO,
  es_CL,
  es_PE,
  es_VE,
  es_UY,
  es_EC,
  es_DO,
  es_PR,
  es_PY,
  es_BO,
  es_CR,
  es_SV,
};

// ── Time slot resolver ────────────────────────────────────────────

function getTimeSlot(hour: number): string {
  if (hour < 4) return 'latenight';
  if (hour < 7) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

// ── Deterministic daily pick ──────────────────────────────────────

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000);
}

function pickPhrase(pool: string[]): string {
  return pool[dayOfYear() % pool.length]!;
}

// ── Public API ────────────────────────────────────────────────────

export interface GreetingContext {
  hour: number;
  weatherCode?: number;
  isDay?: boolean;
  temperature?: number;
  locale?: string;
  displayName?: string | null;
}

export interface GreetingResult {
  /** Text before the name (or full greeting if no name) */
  before: string;
  /** Text after the name (empty if no name or name at end) */
  after: string;
}

/**
 * Returns a creative, locale-aware greeting split around the user's name.
 * The component renders: before + <bold>{name}</bold> + after.
 *
 * Fallback chain: locale+slot+vibe → locale+slot → en+slot+vibe → en+slot.
 * Rotates daily for freshness. Always returns a result — never throws.
 */
/**
 * Resolves a raw locale string into an ordered list of pool keys to try.
 * e.g. "es-AR" → ["es_AR", "es"], "pt-BR" → ["pt_BR", "pt"], "en" → ["en"]
 */
function resolveLocalePools(rawLocale: string): PhrasePool[] {
  const pools: PhrasePool[] = [];
  // Try exact match first (handles "es_AR" or "es-AR" → "es_AR")
  const normalized = rawLocale.replace('-', '_');
  if (LOCALE_POOLS[normalized]) pools.push(LOCALE_POOLS[normalized]!);
  // Try base language (es-AR → es)
  const base = rawLocale.split(/[-_]/)[0]!;
  if (base !== normalized && LOCALE_POOLS[base]) pools.push(LOCALE_POOLS[base]!);
  return pools;
}

export function getCreativeGreeting(ctx: GreetingContext): GreetingResult {
  const slot = getTimeSlot(ctx.hour);
  const vibe = getWeatherVibe(ctx.weatherCode, ctx.temperature);
  const locale = ctx.locale || 'en';
  const localePools = resolveLocalePools(locale);
  const enPool = LOCALE_POOLS.en!;

  // Resolve template with fallback chain:
  // country-specific+slot+vibe → country-specific+slot →
  // base-locale+slot+vibe → base-locale+slot →
  // en+slot+vibe → en+slot → ultimate fallback
  let template: string | undefined;

  if (vibe) {
    const key = `${slot}_${vibe}`;
    for (const pool of localePools) {
      if (pool[key]?.length) {
        template = pickPhrase(pool[key]!);
        break;
      }
    }
    if (!template && enPool[key]?.length) {
      template = pickPhrase(enPool[key]!);
    }
  }

  if (!template) {
    for (const pool of localePools) {
      if (pool[slot]?.length) {
        template = pickPhrase(pool[slot]!);
        break;
      }
    }
  }

  if (!template && enPool[slot]?.length) {
    template = pickPhrase(enPool[slot]!);
  }

  if (!template) {
    template = 'Hello, {name}';
  }

  return resolveTemplate(template, ctx.displayName);
}
