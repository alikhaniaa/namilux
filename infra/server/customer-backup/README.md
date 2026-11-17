# Namilux backups on a Windows computer

This package creates a **fresh encrypted backup** and downloads it to the customer's Windows PC. It leaves the website running. Run it manually or weekly with Task Scheduler. Keep the existing nightly server backups: weekly copies alone can lose up to a week's new orders if the server is lost.

## One time setup

An operator should help with this section; subsequent backups use one command.

1. Install PowerShell 7 and the Windows OpenSSH Client. Install `age` on Windows using `winget install --id FiloSottile.age`. The server also needs Bash, PostgreSQL clients, Python 3.11+, age, and the standard Linux utilities. The script refuses to continue if prerequisites fail; it never installs packages.
2. Obtain the **customer's own authorized SSH key**. The current script uses the authorized `root` account to read database/config backups. Keep that key private; do not give customers a developer's personal deployment key. For unattended use, an operator should configure appropriately protected key access under the scheduled Windows account. This package does not install accounts or change server authentication.
3. Verify the server host-key fingerprint through the hosting console or the existing trusted operator, then establish the customer's `known_hosts` entry. Unknown or changed keys must fail. Do not disable host-key checking or treat an unverified `ssh-keyscan` result as trust.
4. Generate a separate encryption identity on the customer's PC:

```powershell
New-Item -ItemType Directory -Force "$HOME\Namilux-Recovery"
age-keygen -o "$HOME\Namilux-Recovery\backup-key.txt"
age-keygen -y "$HOME\Namilux-Recovery\backup-key.txt"
```

The final command prints the **public recipient**, starting with `age1`. Put only that public value in the configuration. Keep `backup-key.txt` private, with an additional protected offline copy. Losing every copy of that private key makes the backups unrecoverable. Never upload it to the VPS, email it, or add it to this package.

5. Keep `Run-Backup.ps1`, `Backup-Namilux.ps1`, `export.sh`, and the configuration in one folder, such as `C:\NamiluxBackup`. Copy `settings.example.psd1` to `settings.psd1` and replace all example paths and the recipient. Leave `BindAddress` absent unless the operator confirms the PC needs it. Use a destination on the customer's PC or external disk, separate from the VPS.

## Run a backup

Open PowerShell 7 in that folder:

```powershell
pwsh -NoProfile -File .\Run-Backup.ps1
```

Success displays `Backup complete`, the saved `.tar.gz.age` path, and its SHA-256. A matching JSON file records the release, size, and checksum. The script verifies the complete downloaded ciphertext before publishing the final file. It preserves older backups and never restores a database or restarts the website. A JSON record without the final archive is not a completed backup.

The bundle contains a fresh database dump, media, the current release source/lockfile/migrations, environment configuration, server scripts, Caddy/PostgreSQL configuration, relevant systemd units and overrides, and recovery metadata. Everything is encrypted before download. Dependencies, built `.next` files, SSH keys, and a full operating-system image are not included. Recovery needs compatible software and dependency installation.

Database-referenced media is checked against the exported dump. Explicit rejected-upload records whose temporary originals were intentionally deleted are recorded separately. Missing normal images/renditions fail the export. Avoid deployments, media deletion and catalog maintenance during a run: the database export is consistent, but this is not an atomic whole-server snapshot.

## Run weekly

After completing configuration, run `pwsh -NoProfile -File .\Install-WeeklyBackup.ps1`. It first performs a real backup and creates the task only if that succeeds. The default is Friday 20:00 in the PC's local time zone; use `-Day Monday -Time 19:00` to change it. It refuses to overwrite an existing task. It runs only while the configured Windows user is logged in, including a locked desktop.

Alternatively, configure it manually:

Use Windows **Task Scheduler → Create Task**:

- Run under the same Windows account that completed the manual backup. Start with **Run only when user is logged on**; unattended credentials/SSH-agent access must be checked separately before changing that.
- Add a weekly trigger at a time the PC is usually on, for example Friday 20:00 in the PC's local time zone.
- Program: the full path to `pwsh.exe` (find it with `(Get-Command pwsh).Source`). Arguments: `-NoProfile -NonInteractive -File "C:\NamiluxBackup\Run-Backup.ps1"`.
- Enable **Run task as soon as possible after a scheduled start is missed**. Select **Do not start a new instance** if the task is already running. Allow at least two hours for a slow connection.
- Run the task once manually and verify a new final backup exists and Last Run Result is `0x0`. A sleeping, offline, or logged-out PC can delay the scheduled copy. Check the latest successful file date each week; this package does not send email/Telegram alerts.

Only the explicitly invoked installer creates a task. Choose daily copies in Task Scheduler if the business cannot tolerate losing up to a week of orders. Keep several dated copies and another offline/external copy; there is no automatic deletion policy.

## Verify recovery before relying on it

First authenticate/decrypt one backup on the customer's PC using the private identity:

```powershell
age --decrypt -i "$HOME\Namilux-Recovery\backup-key.txt" -o "C:\PRIVATE_RECOVERY_FOLDER\backup.tar.gz" "C:\PATH_TO_BACKUP\RUN_ID.tar.gz.age"
tar -tzf "C:\PRIVATE_RECOVERY_FOLDER\backup.tar.gz"
```

Create the private recovery folder first; the decrypted archive contains customer data and secrets. Use a fresh output name. **Do not use PowerShell `>` to write binary output.** After inspecting archive entries, extract only in an isolated private directory, verify `CHECKSUMS.sha256`, and follow `RECOVERY.txt`.

An operator must perform a full restore drill on a **separate host/database**, using PostgreSQL clients compatible with the recorded server version. Recreate application roles, reconcile database credentials, restore under the intended owner, and reapply the reviewed grants. Preserve payment/signing secrets securely, but disable live payment, SMS, notification calls and worker schedules during the drill. Never test restoration over the live store. Archive listing/checksums alone do not prove a database restore works.

## If a backup fails

Read the failure stage and run ID. Failures after starting the export also try to save a `<runId>.failed.json` record in the destination, so scheduled failures can be inspected without console output. Check SSH access, verified host keys, required programs, free disk space, and the encryption recipient. An operator can rerun the export from a trusted shell to inspect server diagnostics. The client suppresses raw remote diagnostics to avoid exposing secrets. A `.partial` file is not a successful backup; keep previous successful copies.

The client attempts to remove only its own temporary server export. If cleanup cannot run because SSH is unavailable or another export holds the lock, give the printed run ID to the operator. After checking that exact run is inactive, the operator can send this same reviewed exporter over SSH with `cleanup RUN_ID`; it takes the export lock and refuses unsafe IDs. Do not delete the main `/opt/namilux/backups` directory. Inspect accumulated incomplete runs rather than silently ignoring repeated failures.

The private export area is `/var/backups/namilux-customer`; the exporter does not source the application's `.env` or execute application code as root. Live installation permissions still need the separate hardening described in the server handover report.

Official references: [age installation and commands](https://github.com/FiloSottile/age), [Microsoft OpenSSH setup](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse), and [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

## Package validation

On 8 October 2026, Windows fixtures passed transport argument validation, binary length/checksum checks, interrupted/malformed downloads, failure records, cleanup, and scheduler-wrapper exit status. Twelve isolated Linux fixtures passed. A real operator backup was then downloaded and decrypted on Windows, all 48 internal checksums passed, and its database dump was restored into an isolated database on the existing PostgreSQL host with application services disabled for that database: 216 orders, 218 payments, 470 products and 1,016 media rows; no invalid indexes or unvalidated constraints. The temporary database was removed. The customer's own computer, key and scheduled task still require setup and a successful run; no customer schedule has been enabled.
