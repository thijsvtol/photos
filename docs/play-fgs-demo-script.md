# Play Console foreground-service demo video — recording script

For the `FOREGROUND_SERVICE_DATA_SYNC` declaration, after the version 49 rejection
("Permission use is either not declared or incorrectly declared" + "Functionality is not initiated
by or perceptible to the user").

The reviewer is checking exactly four things. Every shot below exists to prove one of them:

1. The foreground service is **started by the user**, not by the app on its own.
2. While it runs, the user can **see** it (a clear, specific notification).
3. The user can **stop** it.
4. What they see **matches the declaration** — uploading the user's photos to their own server.

Target length: **60–90 seconds**. Do it in one continuous take if you can; a reviewer distrusts cuts
around the moment work starts.

---

## Before you hit record

| Check | Why it matters |
| --- | --- |
| Install the **release** build of versionCode 50 | The video must show the build you're submitting |
| Sign in, and have an event you can upload to | Upload button only appears with upload permission |
| **Connect to Wi-Fi** | "Wi-Fi only" defaults to on — on cellular nothing will upload and the video shows nothing |
| Put ~10–15 photos in a folder (e.g. `DCIM/Camera`) | Enough that progress visibly moves; not so many it drags |
| Remove that folder from Folder Sync if already added, or tap **Forget sync history** | Otherwise dedupe correctly skips everything and nothing uploads |
| Battery above ~30%, not in battery saver | "Skip when battery is low" can defer the run |
| Screen recording **with the status bar visible** | The notification is the whole point |
| Silence other notifications / use Do Not Disturb off but clear the shade | Reviewer must not be distracted |

Record in portrait, device default resolution. No music. Narration optional — captions are enough.

---

## Scene 1 — Manual upload (0:00–0:35)

**This is the clearest proof of "user-initiated". Lead with it.**

| # | Action | Must be on screen |
| --- | --- | --- |
| 1 | Open the app, tap into an event | Event gallery, existing photos |
| 2 | **Pause ~2s on the blue "Upload" button before tapping** | The button the user is about to press |
| 3 | Tap **Upload** | System file picker opens |
| 4 | Select 10–15 photos, confirm | Selection visible |
| 5 | **Swipe down the notification shade immediately** | Notification: **"Uploading Photos"**, body **"N of M completed"**, progress bar moving |
| 6 | Hold ~5s so the counter visibly advances | Progress genuinely changing, not frozen |
| 7 | Expand the notification | The **"Cancel uploads"** action button |

Suggested captions:

- 0:02 — `The user taps Upload and chooses which photos to upload.`
- 0:18 — `A notification shows upload progress the whole time.`

## Scene 2 — Stopping it (0:35–0:50)

**This is the shot version 49 could not have had. Do not skip it.**

| # | Action | Must be on screen |
| --- | --- | --- |
| 8 | Tap **Cancel uploads** on the notification | The tap itself |
| 9 | Wait ~3s | Notification disappears, then **"Uploads stopped"** summary appears |
| 10 | Open the app again | Remaining photos still queued, nothing lost |

Caption:

- 0:37 — `The user can stop the upload at any time from the notification.`

## Scene 3 — Folder sync, user-initiated (0:50–1:20)

Shows the second entry point into the same use case.

| # | Action | Must be on screen |
| --- | --- | --- |
| 11 | In the event, tap the **Settings** (gear) button | Event settings sheet opens |
| 12 | Scroll to **Folder Sync** | The section heading |
| 13 | Tap **Select Folder**, pick your photo folder | Android folder picker, then the folder listed in-app |
| 14 | **Pause ~3s on the sync settings** | "Sync in the background", "Wi-Fi only", "Skip when battery is low", "Check for new photos" |
| 15 | Tap **Sync now** | The tap |
| 16 | Pull down the shade | Notification **"Uploading photos to your library"**, **"Photo N of M • DCIM/Camera"**, with **Stop** and **Turn off** |
| 17 | Tap **Stop** | Notification clears |

Captions:

- 0:52 — `The user chooses a folder to upload to this album.`
- 1:05 — `The user starts the upload. It can be stopped or turned off at any time.`

---

## Do not do these

- **Don't present the hourly background scan as the foreground-service use case.** It deliberately
  does *not* take a foreground service any more (see `SyncScheduler.KEY_USER_INITIATED`). Showing it
  invites the same "not initiated by the user" finding again.
- **Don't cut between "user taps" and "notification appears."** That gap is exactly what a reviewer
  is looking at. Keep it continuous.
- **Don't show only the in-app progress bar.** The reviewer needs the *system* notification.
- **Don't speed up or time-lapse.** Progress must look real.
- **Don't show sign-in, event creation, or gallery browsing.** Anything not about the upload dilutes it.

---

## The declaration text

The video is only half of it — version 49 was also rejected because the declaration itself was wrong.
Change the `dataSync` use case away from **"Local Processing: Import Export"** (that's for on-device
import/export, which this app doesn't do) to the **upload-to-server** case.

Wording to adapt:

> TvT Photos is a self-hosted photo library. The user selects photos, or a folder of photos, to
> upload to their own server. Uploads are started by the user — by tapping Upload and choosing
> files, or by tapping Sync now on a folder they selected — and run as a foreground service so a
> large batch completes reliably when the screen locks, instead of being interrupted partway and
> leaving photos missing from the album.
>
> While uploading, an ongoing notification shows the current file and overall progress, and offers
> Stop (end this upload) and Turn off (disable background uploads entirely). The service stops as
> soon as the batch finishes or the user stops it.
>
> Scheduled background checks for new photos do not use a foreground service; they run as deferrable
> WorkManager jobs.

That last paragraph is worth including — it tells the reviewer you've drawn the line where the policy
draws it.

---

## Submitting

1. Upload the video to YouTube as **Unlisted** (not Private — reviewers can't see Private).
2. Play Console → App content → **Foreground service permissions** → update the declaration and the
   video link.
3. App bundle explorer → make sure **version code 49 is inactive / "Not included"**, and roll out 50.
4. Re-read the declaration against the video once more. The rejection reason was literally
   "in-app experience or video does not match the declaration" — that's the check that failed.
