// Pure utility: compute free time blocks for a single date, given calendar events,
// schedule, and planning-window constraints. No I/O — callers fetch Supabase data.

const DEFAULT_MIN_BLOCK_MINUTES = 20;

/**
 * Compute free time blocks for a single date in the user's timezone.
 *
 * @param {Array<{start: string, end: string}>} calendarEvents  ISO datetime strings
 * @param {Array<{day: number, start: string, end: string}>} weeklySchedule  day: 1=Mon…7=Sun
 * @param {Array<{date: string, type: 'off'|'custom', hours?: {start: string, end: string}}>} scheduleExceptions
 * @param {{hard_floor: string, soft_ceiling: string}|null} planningWindow  HH:MM strings
 * @param {Array<{day_of_week: number, start_time: string, end_time: string, released_at: string|null}>} rejectedBlocks  day_of_week: 0=Sun…6=Sat
 * @param {string} date  YYYY-MM-DD
 * @param {string} userTz  IANA timezone (e.g. 'America/Toronto')
 * @returns {Array<{startISO: string, endISO: string, durationMinutes: number, preferred: boolean}>}
 */
export function computeFreeBlocks(
  calendarEvents,
  weeklySchedule,
  scheduleExceptions,
  planningWindow,
  rejectedBlocks,
  date,
  userTz,
) {
  // Step 1: Check schedule exceptions
  const exception = (scheduleExceptions ?? []).find(e => e.date === date);
  if (exception?.type === 'off') return [];

  let workStart, workEnd;
  if (exception?.type === 'custom' && exception.hours) {
    workStart = exception.hours.start;
    workEnd   = exception.hours.end;
  } else {
    // Step 2: Find working window from weekly schedule (1=Mon…7=Sun)
    const dayEntry = (weeklySchedule ?? []).find(d => d.day === isoWeekday(date, userTz));
    if (!dayEntry) return [];
    workStart = dayEntry.start;
    workEnd   = dayEntry.end;
  }

  // Step 3: Clip working window start against hard_floor
  const hardFloor = planningWindow?.hard_floor;
  if (hardFloor && hhmmToMinutes(workStart) < hhmmToMinutes(hardFloor)) {
    workStart = hardFloor;
  }

  const windowStartMs = hhmmToEpoch(date, workStart, userTz);
  const windowEndMs   = hhmmToEpoch(date, workEnd,   userTz);
  if (windowStartMs >= windowEndMs) return [];

  // Step 4: Subtract sorted calendar events from working window
  const events = (calendarEvents ?? [])
    .map(e => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
    .filter(e => e.start < windowEndMs && e.end > windowStartMs)
    .sort((a, b) => a.start - b.start);

  const gaps = [];
  let cursor = windowStartMs;
  for (const ev of events) {
    if (ev.start > cursor) gaps.push({ start: cursor, end: ev.start });
    cursor = Math.max(cursor, ev.end);
  }
  if (cursor < windowEndMs) gaps.push({ start: cursor, end: windowEndMs });

  // Step 5: Subtract active block rejections (released_at IS NULL)
  const activeRejections = (rejectedBlocks ?? []).filter(
    r => r.day_of_week === jsWeekday(date, userTz) && r.released_at == null,
  );

  let blocks = gaps;
  for (const r of activeRejections) {
    const rStart = hhmmToEpoch(date, r.start_time.slice(0, 5), userTz);
    const rEnd   = hhmmToEpoch(date, r.end_time.slice(0, 5),   userTz);
    blocks = blocks.flatMap(b => subtractInterval(b, { start: rStart, end: rEnd }));
  }

  // Steps 6–8: Drop short blocks, tag preferred, sort
  const softCeilingMs = planningWindow?.soft_ceiling
    ? hhmmToEpoch(date, planningWindow.soft_ceiling, userTz)
    : windowEndMs;

  return blocks
    .filter(b => b.end - b.start >= DEFAULT_MIN_BLOCK_MINUTES * 60_000)
    .map(b => ({
      startISO:        new Date(b.start).toISOString(),
      endISO:          new Date(b.end).toISOString(),
      durationMinutes: Math.round((b.end - b.start) / 60_000),
      preferred:       b.start < softCeilingMs,
    }))
    .sort((a, b) => a.startISO.localeCompare(b.startISO));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** HH:MM → integer minutes (for comparison only). */
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert "HH:MM" on `dateStr` in `tz` to UTC epoch ms.
 * Approach: treat the desired local time as UTC, measure the drift between
 * that UTC moment's actual local representation and the desired time, correct.
 * One iteration handles standard offsets; DST transitions at 2am don't affect
 * working-hours inputs (06:00–22:00).
 */
function hhmmToEpoch(dateStr, hhMM, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m]     = hhMM.split(':').map(Number);

  const guess = new Date(Date.UTC(y, mo - 1, d, h, m, 0));

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(guess);

  const p = {};
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }

  const wantMs = Date.UTC(y, mo - 1, d, h, m);
  const gotMs  = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

  return guess.getTime() + (wantMs - gotMs);
}

/** ISO weekday for `dateStr` in `tz`: 1=Mon … 7=Sun. */
function isoWeekday(dateStr, tz) {
  const d    = new Date(`${dateStr}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[name];
}

/** JS weekday for `dateStr` in `tz`: 0=Sun … 6=Sat (matches block_rejections.day_of_week). */
function jsWeekday(dateStr, tz) {
  const iso = isoWeekday(dateStr, tz);
  return iso === 7 ? 0 : iso;
}

/** Subtract `removal` from `block`. Returns 0–2 sub-blocks. */
function subtractInterval(block, removal) {
  if (removal.end <= block.start || removal.start >= block.end) return [block];
  const result = [];
  if (removal.start > block.start) result.push({ start: block.start, end: removal.start });
  if (removal.end   < block.end)   result.push({ start: removal.end, end: block.end });
  return result;
}
