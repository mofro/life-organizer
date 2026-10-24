#!/usr/bin/env python3
"""
Read reminders from Apple Reminders' local SQLite store for a named list.

Bypasses the Reminders app (and the iCloud round-trip its AppleScript API
requires for shared lists), which prevents ETIMEDOUT on Family and other
shared iCloud lists.

Writes to the store are still handled via AppleScript — SQLite is read-only.

Usage:
  python3 get-reminders.py [list-name]
  # default list-name: Family

Outputs JSON array of:
  { uuid, name, body, completed, modifiedAt, dueDate, priority, flagged }

  uuid:       string — matches x-apple-reminder://<uuid> in AppleScript
  name:       string
  body:       string (may be empty)
  completed:  boolean
  modifiedAt: ISO 8601 UTC string, or null
  dueDate:    ISO 8601 UTC string, or null
  priority:   integer — 0=none, 1=high, 5=medium, 9=low  (Reminders/iCal encoding)
  flagged:    boolean

Exits 0 on success (even if list is empty).
Exits 1 if the list is not found.
Exits 2 on database error.
Stderr is diagnostic only.
"""
import sys, os, glob, json, sqlite3
from datetime import datetime, timezone, timedelta

LIST_NAME = sys.argv[1] if len(sys.argv) > 1 else 'Family'

STORES = os.path.expanduser(
    '~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores'
)

# Apple Core Data timestamps are seconds since 2001-01-01 UTC (not Unix epoch).
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)


def apple_ts_to_iso(ts):
    if ts is None:
        return None
    try:
        return (APPLE_EPOCH + timedelta(seconds=float(ts))).isoformat()
    except (TypeError, ValueError):
        return None


def read_reminders(db_path, list_name):
    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    except Exception as e:
        print(f'Cannot open {db_path}: {e}', file=sys.stderr)
        return None  # None = db not usable; [] = list not found

    try:
        list_row = db.execute(
            'SELECT Z_PK FROM ZREMCDBASELIST WHERE ZNAME=? AND ZMARKEDFORDELETION=0',
            (list_name,)
        ).fetchone()
    except Exception as e:
        print(f'List query failed in {db_path}: {e}', file=sys.stderr)
        db.close()
        return None

    if not list_row:
        db.close()
        return []  # List not in this db file

    list_pk = list_row[0]

    try:
        rows = db.execute(
            '''SELECT
                 ZCKIDENTIFIER,
                 ZTITLE,
                 ZNOTES,
                 ZCOMPLETED,
                 ZLASTMODIFIEDDATE,
                 ZDUEDATE,
                 ZPRIORITY,
                 ZFLAGGED
               FROM ZREMCDREMINDER
               WHERE ZLIST=? AND ZMARKEDFORDELETION=0''',
            (list_pk,)
        ).fetchall()
    except Exception as e:
        print(f'Reminders query failed in {db_path}: {e}', file=sys.stderr)
        db.close()
        return None

    db.close()

    result = []
    for uuid, title, notes, completed, mod_ts, due_ts, priority, flagged in rows:
        if not uuid:
            continue
        result.append({
            'uuid':       uuid,
            'name':       title or '',
            'body':       notes or '',
            'completed':  bool(completed),
            'modifiedAt': apple_ts_to_iso(mod_ts),
            'dueDate':    apple_ts_to_iso(due_ts),
            'priority':   priority or 0,
            'flagged':    bool(flagged),
        })
    return result


result = None
for db_path in sorted(glob.glob(os.path.join(STORES, 'Data-*.sqlite'))):
    rows = read_reminders(db_path, LIST_NAME)
    if rows is None:
        continue        # DB unreadable — try next
    if rows == []:
        continue        # List not in this DB — try next
    result = rows
    break

if result is None:
    print(f'List "{LIST_NAME}" not found in any Reminders database', file=sys.stderr)
    sys.exit(1)

print(json.dumps(result))
