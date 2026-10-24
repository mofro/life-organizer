-- cleanup-duplicate-reminders.applescript
-- Removes stale/duplicate reminders from the Family list created by the
-- runaway B→R sync (getReminderById ETIMEDOUT bug, now fixed).
--
-- Run with: osascript scripts/reminders-sync/cleanup-duplicate-reminders.applescript
--
-- Keepers after this runs (one per task):
--   F49DA7F3  [Mo] Shop for Tarim Shaiel → life-mrb
--   4376455C  [Mo] Ask ETE talk questions → life-zyi
--   31BFB2DA  [Mo] Check all bills for old phone number → life-who
--   3D6B5DAA  [Mo] Doorbell transformer → life-yy5
--   5D7F1679  [Mo] Sign a Christmas card for mom → life-hje
--   117A7103  [Mo] Check corner in office and under futon → life-gke

tell application "Reminders"
    set theList to list "Family"

    -- Originals (no [Mo] prefix) — pre-sync, superseded by managed [Mo] versions
    -- Plus completed/duplicate [Mo] entries
    set staleIds to {¬
        "x-apple-reminder://47374B9F-BACE-54BB-A74D-2B1D1F94BBBC", ¬
        "x-apple-reminder://7284ED20-0774-5120-8DBA-5ABBBE6852F9", ¬
        "x-apple-reminder://DE150B7F-F5EF-5E8E-9C3A-164974F71890", ¬
        "x-apple-reminder://6864D8B9-749E-41CE-B42C-62FFE5893DDB", ¬
        "x-apple-reminder://69A67F02-5D3E-4558-A9B0-8F48CF394B12", ¬
        "x-apple-reminder://E4225575-2686-45C2-B89A-BD31CBD0BC88", ¬
        "x-apple-reminder://909C3FBD-D61B-451E-9CC0-0ABF3D2C4BBB", ¬
        "x-apple-reminder://8A23DB8A-3948-4D38-B6A8-0088973F596E", ¬
        "x-apple-reminder://A3AC0966-87D3-4316-8A4A-FA7E51403BE1"}

    set deletedCount to 0
    repeat with rid in staleIds
        try
            set target to first reminder of theList whose id = rid
            set targetName to name of target
            delete target
            log "Deleted: " & targetName & " (" & rid & ")"
            set deletedCount to deletedCount + 1
        on error msg
            log "Skip (not found): " & rid & " — " & msg
        end try
    end repeat

    return "Done. Deleted " & deletedCount & " duplicate reminder(s)."
end tell
