// Minimal iCalendar parser — no dependencies, runs in both Node and Cloudflare Workers.
//
// Scope is deliberately narrow: the two feeds we consume are Google Calendar and
// D2L/Brightspace, both of which emit well-formed, predictable ICS. We handle the
// pieces those two actually use and nothing more.

const DEFAULT_TZ = 'America/New_York';

// Cache only immutable timezone formatter configuration, never calendar data.
// Bound it because TZID is provider input; wall-time conversion still evaluates
// the offset at each instant, preserving DST behaviour.
const zoneFormatters = new Map();
function zoneFormatter(tz, weekday = false) {
  const key = `${weekday ? 'weekday' : 'offset'}:${tz}`;
  let formatter = zoneFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', weekday
      ? { timeZone: tz, weekday: 'short' }
      : { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (zoneFormatters.size >= 32) zoneFormatters.clear();
    zoneFormatters.set(key, formatter);
  }
  return formatter;
}

/** RFC 5545 line unfolding: a CRLF followed by a space or tab continues the previous line. */
function unfold(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r[ \t]/g, '');
}

/** Unescape a TEXT-typed property value. */
function unescapeText(v) {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Split a content line into { name, params, value }.
 * The value is everything after the first unquoted colon.
 */
function parseLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments = [];
  let cur = '';
  inQuotes = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '"') { inQuotes = !inQuotes; cur += c; }
    else if (c === ';' && !inQuotes) { segments.push(cur); cur = ''; }
    else cur += c;
  }
  segments.push(cur);

  const name = segments[0].toUpperCase();
  const params = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    const k = seg.slice(0, eq).toUpperCase();
    let v = seg.slice(eq + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  return { name, params, value };
}

/**
 * Offset, in milliseconds, that must be ADDED to a UTC instant to get wall-clock
 * time in `tz`. Uses Intl, so it is correct across DST without a tz database.
 */
function tzOffsetMs(tz, instant) {
  const dtf = zoneFormatter(tz);
  const p = {};
  for (const { type, value } of dtf.formatToParts(instant)) p[type] = value;
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asUTC - instant.getTime();
}

/**
 * Convert a wall-clock time in `tz` to the corresponding UTC instant.
 * Use the pre-transition offset first. RFC 5545 chooses the first instant in
 * an autumn overlap and the pre-gap offset for a spring-gap property value.
 * Recurrence expansion separately skips nonexistent local times.
 */
function wallTimeToInstant(y, mo, d, h, mi, s, tz) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const before = tzOffsetMs(tz, new Date(naive - 86400000));
  const guess = naive - before;
  const actual = tzOffsetMs(tz, new Date(guess));
  if (before === actual) return new Date(guess);
  const corrected = naive - actual;
  return new Date(tzOffsetMs(tz, new Date(corrected)) === actual ? corrected : guess);
}

function validCivil(y, mo, d, h = 0, mi = 0, s = 0) {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return false;
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

function wallParts(instant, tz) {
  const p = {};
  for (const { type, value } of zoneFormatter(tz).formatToParts(instant)) p[type] = value;
  return [Number(p.year), Number(p.month), Number(p.day), p.hour === '24' ? 0 : Number(p.hour), Number(p.minute), Number(p.second)];
}

const DAY_MS = 86400000;
function civilDate(parts, dayOffset = 0) {
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + dayOffset, parts[3] || 0, parts[4] || 0, parts[5] || 0));
}
function civilParts(date) {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
}
function addLocalDays(instant, days, tz) {
  return wallTimeToInstant(...civilParts(civilDate(wallParts(instant, tz), days)), tz);
}

/**
 * Parse a DATE or DATE-TIME property into { date, allDay }.
 * Handles the three forms our feeds emit:
 *   VALUE=DATE:20260821                    -> all-day
 *   20260823T035959Z                       -> UTC instant
 *   TZID=America/New_York:20260820T113500  -> zoned wall time
 */
function parseDateProp(prop, defaultTz = DEFAULT_TZ) {
  if (!prop) return null;
  const v = prop.value.trim();
  const isDateOnly = prop.params.VALUE === 'DATE' || /^\d{8}$/.test(v);

  if (isDateOnly) {
    if (!/^\d{8}$/.test(v)) return null;
    const y = Number(v.slice(0, 4)), mo = Number(v.slice(4, 6)), d = Number(v.slice(6, 8));
    if (!validCivil(y, mo, d)) return null;
    // Anchor all-day items to local midnight so day comparisons line up with the user's day.
    return { date: wallTimeToInstant(y, mo, d, 0, 0, 0, defaultTz), allDay: true, tz: defaultTz, wall: [y, mo, d, 0, 0, 0] };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, z] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds), h = Number(hs), mi = Number(mis), s = Number(ss);
  if (!validCivil(y, mo, d, h, mi, s)) return null;
  const wall = [y, mo, d, h, mi, Math.min(s, 59)];

  if (z) return { date: civilDate(wall), allDay: false, tz: 'UTC', wall };
  const tz = prop.params.TZID || defaultTz;
  return { date: wallTimeToInstant(...wall, tz), allDay: false, tz, wall };
}

/** Parse an RRULE value into a plain object. */
function parseRRule(value) {
  const out = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    const key = part.slice(0, eq).toUpperCase();
    if (eq <= 0 || Object.hasOwn(out, key)) { out._INVALID = '1'; continue; }
    out[key] = part.slice(eq + 1);
  }
  return out;
}

const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/**
 * Expand the provider's ordinary day/week/month/year rules in civil time. Unknown
 * rule parts are not approximated: the base remains visible with a coverage warning.
 * COUNT counts the series before EXDATE; old, unbounded series jump to the window.
 */
function expandRecurrence(base, rrule, windowStart, windowEnd, tz = DEFAULT_TZ) {
  const freq = (rrule.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    return { occurrences: [base.start], unsupported: ['SECONDLY', 'MINUTELY', 'HOURLY'].includes(freq) ? freq : 'FREQUENCY' };
  }
  const allowed = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'COUNT', 'UNTIL', 'WKST']);
  const knownUnsupported = new Set(['BYSECOND', 'BYMINUTE', 'BYHOUR', 'BYYEARDAY', 'BYWEEKNO', 'BYSETPOS', 'RSCALE', 'SKIP']);
  // Coverage warnings are stable codes, never untrusted provider text.
  const unsupported = Object.keys(rrule).filter(k => !allowed.has(k)).map(k => knownUnsupported.has(k) ? k : 'RULE_PART');
  for (const key of allowed) if (Object.hasOwn(rrule, key) && !rrule[key]) unsupported.push(key);
  const integer = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (rrule.INTERVAL && !integer(rrule.INTERVAL)) unsupported.push('INTERVAL');
  if (rrule.COUNT && !integer(rrule.COUNT)) unsupported.push('COUNT');
  if (rrule.COUNT && rrule.UNTIL) unsupported.push('COUNT_AND_UNTIL');
  const interval = Number(rrule.INTERVAL || 1);
  const count = rrule.COUNT ? Number(rrule.COUNT) : null;
  const wkst = rrule.WKST ? DAY_INDEX[rrule.WKST.toUpperCase()] : DAY_INDEX.MO;
  if (wkst === undefined) unsupported.push('WKST');

  const byDay = rrule.BYDAY ? rrule.BYDAY.toUpperCase().split(',').map(value => {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(value);
    if (!m || (m[1] && (Number(m[1]) === 0 || Math.abs(Number(m[1])) > 53 || ['DAILY', 'WEEKLY'].includes(freq)))) {
      unsupported.push('BYDAY'); return null;
    }
    return { weekday: DAY_INDEX[m[2]], ordinal: m[1] ? Number(m[1]) : null };
  }) : null;
  function numberList(value, key, min, max, zeroAllowed = false) {
    if (!value) return null;
    const values = value.split(',').map(Number);
    if (values.some((v, i) => !/^[+-]?\d+$/.test(value.split(',')[i]) || !Number.isInteger(v) || v < min || v > max || (!zeroAllowed && v === 0))) unsupported.push(key);
    return values;
  }
  const byMonthDay = numberList(rrule.BYMONTHDAY, 'BYMONTHDAY', -31, 31);
  const byMonth = numberList(rrule.BYMONTH, 'BYMONTH', 1, 12);
  if (freq === 'WEEKLY' && byMonthDay) unsupported.push('BYMONTHDAY');
  let until = null;
  if (rrule.UNTIL) {
    const parsed = parseDateProp({ value: rrule.UNTIL, params: {} }, tz);
    until = parsed ? parsed.date : null;
    if (!until) unsupported.push('UNTIL');
  }
  if (unsupported.length) return { occurrences: [base.start], unsupported: [...new Set(unsupported)].join(',') };

  const wall = base.wall || wallParts(base.start, tz);
  const origin = civilDate(wall);
  const startWeekday = origin.getUTCDay();
  const startWeekdayFromWkst = (startWeekday - wkst + 7) % 7;
  const windowWallStart = civilDate(wallParts(windowStart, tz));
  const windowWallEnd = civilDate(wallParts(windowEnd, tz));
  // A day either side accounts for differing UTC offsets at the window boundary.
  const firstOffset = Math.max(0, Math.floor((windowWallStart - origin) / DAY_MS) - 1);
  const lastOffset = Math.max(0, Math.ceil((windowWallEnd - origin) / DAY_MS) + 1);
  const occurrences = [];
  let emitted = 0;
  let walked = 0;
  for (let dayOffset = count ? 0 : firstOffset; dayOffset <= lastOffset; dayOffset++) {
    if (count !== null && emitted >= count) break;
    if (++walked > 36600) return { occurrences, unsupported: 'EXPANSION_LIMIT' };
    const civil = new Date(origin.getTime() + dayOffset * DAY_MS);
    const year = civil.getUTCFullYear(), month = civil.getUTCMonth() + 1, day = civil.getUTCDate();
    const weekday = civil.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthOffset = (year - wall[0]) * 12 + month - wall[1];
    const weekIndex = Math.floor((dayOffset + startWeekdayFromWkst) / 7);
    let matches = freq === 'DAILY' ? dayOffset % interval === 0
      : freq === 'WEEKLY' ? weekIndex % interval === 0
      : freq === 'MONTHLY' ? monthOffset % interval === 0
      : (year - wall[0]) % interval === 0;
    if (byMonth) matches &&= byMonth.includes(month);
    else if (freq === 'YEARLY' && !byMonthDay && !byDay) matches &&= month === wall[1];
    if (byMonthDay) matches &&= byMonthDay.some(n => (n > 0 ? n : daysInMonth + n + 1) === day);
    if (byDay) matches &&= byDay.some(entry => {
      if (weekday !== entry.weekday) return false;
      if (!entry.ordinal) return true;
      // YEARLY ordinals without BYMONTH refer to the whole year; otherwise month.
      const inYear = freq === 'YEARLY' && !byMonth;
      const position = inYear ? Math.floor((civil - Date.UTC(year, 0, 1, ...wall.slice(3))) / DAY_MS) + 1 : day;
      const total = inYear ? (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS : daysInMonth;
      return entry.ordinal > 0 ? Math.floor((position - 1) / 7) + 1 === entry.ordinal
        : -(Math.floor((total - position) / 7) + 1) === entry.ordinal;
    });
    else if (freq === 'WEEKLY') {
      matches &&= weekday === startWeekday;
    } else if (['MONTHLY', 'YEARLY'].includes(freq) && !byMonthDay) {
      matches &&= day === wall[2];
    }
    if (!matches) continue;
    const parts = civilParts(civil);
    const candidate = tz === 'UTC' ? civil : wallTimeToInstant(...parts, tz);
    if (until && candidate > until) break;
    // Generated spring-gap occurrences are ignored and do not consume COUNT.
    if (tz !== 'UTC' && wallParts(candidate, tz).some((v, i) => v !== parts[i])) continue;
    emitted++;
    if (candidate >= windowStart && candidate <= windowEnd) occurrences.push(candidate);
  }
  return { occurrences, unsupported: null };
}

function parseDuration(value) {
  const week = /^\+?P(\d+)W$/.exec(value);
  const m = /^\+?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!week && (!m || !m.slice(1).some(Boolean) || value.endsWith('T'))) return null;
  const days = week ? Number(week[1]) * 7 : Number(m[1] || 0);
  const timeMs = week ? 0 : (Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)) * 1000;
  return Number.isSafeInteger(days) && Number.isSafeInteger(timeMs) ? { days, timeMs } : null;
}

/**
 * Parse an ICS document into a flat list of event occurrences within the window.
 *
 * Handles the two things Google emits that naive parsers get wrong:
 *   - EXDATE, which cancels individual occurrences of a series
 *   - RECURRENCE-ID overrides, which are separate VEVENTs replacing one occurrence
 */
export function parseICS(text, { windowStart, windowEnd, source = 'unknown', defaultTz = DEFAULT_TZ } = {}) {
  if (!(windowStart instanceof Date) || !(windowEnd instanceof Date) || !Number.isFinite(+windowStart) || !Number.isFinite(+windowEnd) || windowStart > windowEnd) throw new Error('invalid_event_window');
  const lines = unfold(text).split(/\r\n|\n|\r/);

  const raw = [];
  let cur = null;
  let depth = 0;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = { props: {}, multi: { EXDATE: [], RDATE: [], RRULE: [] } }; depth = 1; continue; }
    if (line.startsWith('END:VEVENT')) { if (cur) raw.push(cur); cur = null; depth = 0; continue; }
    // Skip nested components (VALARM, and VTIMEZONE never appears inside VEVENT).
    if (cur && line.startsWith('BEGIN:')) { depth++; continue; }
    if (cur && line.startsWith('END:')) { depth--; continue; }
    if (!cur || depth !== 1) continue;

    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'EXDATE' || p.name === 'RDATE') cur.multi[p.name].push(p);
    else {
      if (p.name === 'RRULE') cur.multi.RRULE.push(p);
      cur.props[p.name] = p;
    }
  }

  const series = new Map(raw.filter(ev => !ev.props['RECURRENCE-ID'] && (ev.props.RRULE || ev.multi.RDATE.length)).map(ev => [ev.props.UID?.value, ev]));
  // Overrides replace a specific occurrence of their parent series.
  const overrides = new Map();
  for (const ev of raw) {
    const rid = ev.props['RECURRENCE-ID'];
    if (!rid) continue;
    const uid = ev.props.UID?.value;
    const parent = series.get(uid);
    const parentStart = parent ? parseDateProp(parent.props.DTSTART, defaultTz) : null;
    const at = parseDateProp(rid, parentStart?.tz || defaultTz);
    if (!at) throw new Error('invalid_event_recurrence_id');
    if (uid && at) overrides.set(`${uid}@${at.date.getTime()}`, true);
  }

  const out = [];
  const warningCounts = new Map();
  const warn = code => warningCounts.set(code, (warningCounts.get(code) || 0) + 1);
  for (const ev of raw) {
    const status = ev.props.STATUS?.value.toUpperCase();
    if (status === 'CANCELLED') continue;

    const dtstart = parseDateProp(ev.props.DTSTART, defaultTz);
    if (!dtstart || !Number.isFinite(dtstart.date.getTime())) throw new Error('invalid_event_start');
    const dtend = parseDateProp(ev.props.DTEND, defaultTz);
    if (ev.props.DTEND && (!dtend || dtend.allDay !== dtstart.allDay || dtend.date < dtstart.date)) throw new Error('invalid_event_end');
    const duration = ev.props.DURATION ? parseDuration(ev.props.DURATION.value) : null;
    if (ev.props.DURATION && (!duration || dtend || (dtstart.allDay && duration.timeMs))) throw new Error('invalid_event_duration');

    const uid = ev.props.UID?.value || '';
    const summary = ev.props.SUMMARY ? unescapeText(ev.props.SUMMARY.value) : '';
    const description = ev.props.DESCRIPTION ? unescapeText(ev.props.DESCRIPTION.value) : '';
    const location = ev.props.LOCATION ? unescapeText(ev.props.LOCATION.value) : '';

    const excluded = new Set();
    for (const ex of ev.multi.EXDATE) {
      for (const v of ex.value.split(',')) {
        const d = parseDateProp({ value: v, params: ex.params }, dtstart.tz);
        if (!d || d.allDay !== dtstart.allDay) throw new Error('invalid_event_exdate');
        excluded.add(d.date.getTime());
      }
    }

    const base = { start: dtstart.date, end: dtend ? dtend.date : null, wall: dtstart.wall };
    const rruleProp = ev.props.RRULE;
    const isOverride = Boolean(ev.props['RECURRENCE-ID']);
    const parent = isOverride ? series.get(uid) : null;
    const parentStart = parent ? parseDateProp(parent.props.DTSTART, defaultTz) : null;
    const recurrenceId = isOverride ? parseDateProp(ev.props['RECURRENCE-ID'], parentStart?.tz || defaultTz) : null;
    if (isOverride && !recurrenceId) throw new Error('invalid_event_recurrence_id');

    // DATE-valued ends and DURATION days stay calendar days across offset changes.
    // Timed DTEND retains the exact duration established by the provider.
    const allDayDays = dtstart.allDay ? (dtend ? (civilDate(dtend.wall) - civilDate(dtstart.wall)) / DAY_MS : duration ? duration.days : 1) : null;
    const durationMs = dtend ? dtend.date - dtstart.date : null;
    const endAt = start => allDayDays !== null ? addLocalDays(start, allDayDays, dtstart.tz)
      : duration ? new Date(+addLocalDays(start, duration.days, dtstart.tz) + duration.timeMs)
      : durationMs !== null ? new Date(+start + durationMs) : null;
    const baseEnd = endAt(base.start);
    if (baseEnd && !Number.isFinite(+baseEnd)) throw new Error('invalid_event_duration');
    // Include a continuing event which began before the window. Recurrence's
    // nominal duration can vary by an hour across DST, so leave one extra day.
    const lookbackMs = baseEnd ? Math.max(0, +baseEnd - +base.start) + DAY_MS : 0;
    const recurrenceWindowStart = new Date(+windowStart - lookbackMs);

    let starts;
    let recurring = Boolean(parent);
    let unsupportedRule = null;

    if (rruleProp && !isOverride) {
      const res = expandRecurrence(base, parseRRule(rruleProp.value), recurrenceWindowStart, windowEnd, dtstart.tz);
      starts = res.occurrences;
      unsupportedRule = res.unsupported;
      recurring = true;
    } else {
      starts = [dtstart.date];
    }
    if (!isOverride && ev.multi.RDATE.length) {
      recurring = true;
      for (const rdate of ev.multi.RDATE) {
        if (rdate.params.VALUE === 'PERIOD') { unsupportedRule = unsupportedRule || 'RDATE_PERIOD'; continue; }
        for (const value of rdate.value.split(',')) {
          const at = parseDateProp({ value, params: rdate.params }, dtstart.tz);
          if (!at || at.allDay !== dtstart.allDay) throw new Error('invalid_event_rdate');
          starts.push(at.date);
        }
      }
    }
    if (ev.multi.RRULE.length > 1) unsupportedRule = unsupportedRule || 'MULTIPLE_RRULE';
    if (isOverride && ev.props['RECURRENCE-ID'].params.RANGE) unsupportedRule = unsupportedRule || 'RECURRENCE_RANGE';
    if (unsupportedRule) warn(`unsupported_recurrence:${unsupportedRule}`);
    starts = [...new Map(starts.map(start => [+start, start])).values()];

    for (const s of starts) {
      if (excluded.has(s.getTime())) continue;
      if (!isOverride && recurring && overrides.has(`${uid}@${s.getTime()}`)) continue;
      const end = endAt(s);
      if (s > windowEnd || (s < windowStart && (!end || end <= windowStart))) continue;

      out.push({
        uid,
        recurrence_anchor: isOverride ? recurrenceId.date.toISOString() : recurring ? s.toISOString() : '',
        summary,
        description,
        location,
        start: s,
        end,
        allDay: dtstart.allDay,
        recurring,
        unsupportedRule,
        source,
      });
    }
  }

  out.sort((a, b) => a.start - b.start);
  Object.defineProperty(out, 'warnings', { value: [...warningCounts].map(([code, count]) => ({ code, count })), enumerable: false });
  return out;
}

export const _internals = { unfold, parseLine, parseDateProp, parseRRule, expandRecurrence, wallTimeToInstant, tzOffsetMs, unescapeText };
