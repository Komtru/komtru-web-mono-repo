# Removing wrongly uploaded trade evidence

Evidence a party adds to a trade (`POST /trades/:id/evidence`, F-028) is shared with the other party the moment it is
attached: the other side is granted read access to the file. The app has no way to take a file back, and the evidence
table is append-only. If someone attached the wrong file, especially one holding personal data, staff remove it by
tombstoning the file.

## Who and how

- Needs the `user.close` permission (the permission behind tombstoning, the same class of act as closing an account).
- Call `POST /admin/files/:id/tombstone` with `{ "reason": "<why, at least 3 characters>" }`. The file id is the
  evidence row's `file_id` (`trade.trade_evidence_media`), which the party or support can read off the trade's evidence.
- Tombstoning is not reversible. It removes the bytes from storage and keeps the file record, so the row stays
  resolvable. A second call is a no-op that returns the first reason.

## What the parties see afterwards

- The evidence row stays (the table is append-only) with its `fileId`. `GET /files/:id` for it answers 410
  `FILE_TOMBSTONED` to everyone, the uploader and staff included.
- On the evidence screen (CWT-S12) the tile reads "<Event> file N was removed." with no retry. Counts still include it.
- Anything the other party already downloaded or screenshotted is theirs: tombstoning stops further reads, it does not
  recall copies. Tell the uploader this when you act on a personal-data report.
- Nothing is added to the trade's history feed; the trade's audit trail carries the `EVIDENCE_ADDED` note from when the
  file was attached.

## Not covered

- There is no un-share short of tombstoning: access grants on a case file can be revoked
  (`DELETE /admin/files/:id/grants/:grantId`), which hides the file from the other party but leaves it with the
  uploader. Use that when the file is wrongly shared but should survive.
- Linking evidence to a dispute case later must use a new link table, never an UPDATE of the evidence row.
