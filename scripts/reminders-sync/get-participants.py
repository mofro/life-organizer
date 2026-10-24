#!/usr/bin/env python3
"""
Read shared-list participants from Apple Reminders' local SQLite store.

The ZCKSERVERSHAREDATA column in ZREMCDBASELIST contains a serialized NSKeyedArchive
of the CloudKit CKShare record, which includes CKShareParticipant entries with full
name (NSPersonNameComponents) and Apple ID email.

Usage:
  python3 get-participants.py [list-name]
  # default list-name: Family

Outputs JSON array of { displayName, email, givenName, familyName } to stdout.
Exits 0 on success, 1 if not found or error. Stderr is diagnostic only.
"""
import sys, os, glob, json, sqlite3, plistlib

LIST_NAME = sys.argv[1] if len(sys.argv) > 1 else 'Family'

STORES = os.path.expanduser(
    '~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores'
)

def res(objects, ref):
    if isinstance(ref, plistlib.UID):
        return objects[ref.data]
    return ref

def extract_participants(db_path, list_name):
    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    except Exception as e:
        print(f'Cannot open {db_path}: {e}', file=sys.stderr)
        return []

    try:
        row = db.execute(
            'SELECT ZCKSERVERSHAREDATA FROM ZREMCDBASELIST WHERE ZNAME=? AND ZSHARINGSTATUS=1',
            (list_name,)
        ).fetchone()
    except Exception:
        return []
    finally:
        db.close()

    if not row or not row[0]:
        return []

    try:
        plist = plistlib.loads(bytes(row[0]))
    except Exception as e:
        print(f'plist parse error: {e}', file=sys.stderr)
        return []

    objects = plist['$objects']
    seen = set()
    participants = []

    for obj in objects:
        if not isinstance(obj, dict) or 'ParticipantID' not in obj:
            continue

        identity = res(objects, obj.get('UserIdentity'))
        if not isinstance(identity, dict):
            continue

        # Name
        name_obj = res(objects, identity.get('NameComponents'))
        given, family = '', ''
        if isinstance(name_obj, dict):
            inner = res(objects, name_obj.get('NS.nameComponentsPrivate'))
            if isinstance(inner, dict):
                g = inner.get('NS.givenName')
                f = inner.get('NS.familyName')
                given = (res(objects, g) if isinstance(g, plistlib.UID) else g) or ''
                family = (res(objects, f) if isinstance(f, plistlib.UID) else f) or ''

        # Email via LookupInfo
        email = ''
        lookup = res(objects, identity.get('LookupInfo'))
        candidates = lookup if isinstance(lookup, list) else ([lookup] if lookup else [])
        for c in candidates:
            c = res(objects, c) if isinstance(c, plistlib.UID) else c
            if isinstance(c, dict):
                e = c.get('EmailAddress')
                if isinstance(e, plistlib.UID):
                    e = res(objects, e)
                if isinstance(e, str) and '@' in e:
                    email = e
                    break

        display = f'{given} {family}'.strip() or email
        key = email or display
        if key and key not in seen:
            seen.add(key)
            participants.append({
                'displayName': display,
                'email': email,
                'givenName': given,
                'familyName': family,
            })

    return participants

result = []
for db_path in sorted(glob.glob(os.path.join(STORES, 'Data-*.sqlite'))):
    p = extract_participants(db_path, LIST_NAME)
    if p:
        result = p
        break

if not result:
    print(f'No participants found for list "{LIST_NAME}"', file=sys.stderr)
    sys.exit(1)

print(json.dumps(result, indent=2))
