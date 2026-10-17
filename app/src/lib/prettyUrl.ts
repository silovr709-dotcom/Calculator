// Красивые адреса для клиента.
//
// Браузерные URL-объекты всегда отдают домен в латинской записи (punycode):
// «рецепт-про.рф» превращается в «xn----itba1bdbcfp1b.xn--p1ai». Клиенту такую
// ссылку отправлять неприятно, поэтому возвращаем домен обратно в кириллицу.

const PUNY_PREFIX = 'xn--';
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adaptBias(delta: number, numPoints: number, firstTime: boolean): number {
  let value = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  value += Math.floor(value / numPoints);
  let k = 0;
  while (value > ((BASE - TMIN) * TMAX) >> 1) {
    value = Math.floor(value / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * value) / (value + SKEW));
}

function digitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;   // 0–9
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;        // a–z
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;        // A–Z
  return BASE;
}

/** Расшифровка одной метки punycode (RFC 3492). При любой ошибке возвращаем как было. */
export function decodePunycodeLabel(label: string): string {
  if (!label.toLowerCase().startsWith(PUNY_PREFIX)) return label;
  const encoded = label.slice(PUNY_PREFIX.length);
  const lastDelimiter = encoded.lastIndexOf('-');
  const basic = lastDelimiter > 0 ? encoded.slice(0, lastDelimiter) : '';
  const digits = lastDelimiter > 0 ? encoded.slice(lastDelimiter + 1) : encoded;

  const output: number[] = [];
  for (const char of basic) output.push(char.codePointAt(0) ?? 0);

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let index = 0;

  while (index < digits.length) {
    const oldI = i;
    let weight = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= digits.length) return label;
      const digit = digitValue(digits.charCodeAt(index));
      index += 1;
      if (digit >= BASE) return label;
      i += digit * weight;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      weight *= BASE - t;
    }
    const outLength = output.length + 1;
    bias = adaptBias(i - oldI, outLength, oldI === 0);
    n += Math.floor(i / outLength);
    i %= outLength;
    output.splice(i, 0, n);
    i += 1;
  }

  try {
    return String.fromCodePoint(...output);
  } catch {
    return label;
  }
}

/** Домен в человеческом виде: xn----itba1bdbcfp1b.xn--p1ai → рецепт-про.рф */
export function prettyHost(host: string): string {
  return host.split('.').map(decodePunycodeLabel).join('.');
}

/** Адрес без лишних «xn--» и без хвоста «index.html». */
export function prettyUrl(url: string | URL): string {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    const host = prettyHost(parsed.hostname);
    const port = parsed.port ? `:${parsed.port}` : '';
    const path = parsed.pathname.replace(/index\.html$/, '');
    return `${parsed.protocol}//${host}${port}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return String(url);
  }
}
