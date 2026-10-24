# Profiles

Manage profiles in **Settings → Your profile**. Each has its own libraries,
preferences, passwords, and tracker/cloud connections. Existing data stays in
**Default**, the owner profile. Give the owner a password before adding profiles.

The owner can delete other profiles; local files are removed on restart, while
cloud backups and tracker lists stay intact. Export anything you want to keep.
The LAN password protects the installation separately from profile passwords.

Back up the full Dango data directory to preserve all profiles. Older releases
only understand Default and do not enforce profile passwords; keep the automatic
`before-profiles` backup if you plan to downgrade.
