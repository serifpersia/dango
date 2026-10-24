# Profiles

Open **Settings → Your profile** to rename your profile, set a password, upload
an image, or switch profiles. Uploaded PNG, JPEG, WebP and GIF images may be up to
2 MB. Clearing an upload restores the connected cloud account image, or the user
icon when no cloud image is available.

An existing installation becomes the **Default** owner profile automatically.
Its databases and connections remain in their existing locations. The first
profile startup saves database and configuration backups under `before-profiles`
(`before-profiles.dev` in development). Renaming Default keeps all its data.

A single profile without a profile password opens automatically. Before adding
another profile, give the owner a password. The owner creates additional profiles
in Settings; these start with empty libraries and independent tracker and cloud
connections. A profile without a password can be selected by anyone who has
access to the installation.

The owner can delete non-owner profiles under **Settings → Your profile → Other
profiles**. Deletion signs the profile out immediately and stops its scheduled
jobs. Local profile files are removed on the next Dango restart, allowing work
already in progress to finish safely. Cloud copies and tracker lists are not
deleted. Export a library before deleting its profile if you want to keep it.
The owner profile cannot be deleted.

The optional LAN password is separate: it protects entry to the installation;
profile passwords protect individual accounts. Server port, LAN lock, host
Discord presence, offline metadata maintenance and host-configured Rclone
remotes remain owner controls.

Each profile has separate anime, manga, TV and ASMR databases. Additional profile
files live under `profiles/<id>` in the normal Dango data directory. Cloud tokens,
provider selection, sync manifests, imports and backups use that profile's
directory. Connecting the same GitHub or Google account to two local profiles is
rejected because the existing remote filenames represent one library. Different
installations can continue syncing the same user's library as before.

Browser preferences are isolated per profile on each device. Existing browser
preferences belong to Default; hardware video delay and Anime4K support stay
device settings. Switching profiles reloads the app and its query cache, and
requests carry the originating profile ID so late playback writes cannot land in
another profile after a switch.

Database exports contain the selected profile's libraries and existing syncable
settings, not the installation's profile registry or login sessions. JSON and
legacy anime database restores target only the signed-in profile. Profile names,
uploaded images and login passwords are installation-local. Back up the whole
data directory if you need to preserve the complete installation.

Older Dango releases do not understand the profile registry or additional
profiles. Keep the pre-profile backup when downgrading; an old release will only
see Default's databases and will not enforce profile passwords.
