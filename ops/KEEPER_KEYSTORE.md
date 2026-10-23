# Local keeper keystore preparation (Windows + Rabby)

The keeper public address is 0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908.
Only that individual account's key is needed, never the seed phrase or Safe
owners' keys. Rabby's address backup screen offers the private-key backup flow:
https://github.com/RabbyHub/Rabby/blob/develop/src/ui/views/AddressDetail/AddressBackup.tsx .

1. Open an ordinary local Windows PowerShell window and run
   `& "FULL_CHECKOUT_PATH\scripts\create-keeper-keystore.ps1"`.
   Node and the checkout's installed ethers dependency are required (already
   available in this workspace). Do not run it through an agent command/tool.
2. Enter a NEW keystore password of at least 16 characters, twice. It need not
   equal the Rabby unlock password. Input is hidden and the password is not saved.
3. In Rabby select the keeper address, open address details/management and choose
   Back up Private Key (labels vary by version). Confirm in Rabby, then paste the
   single account key ONLY into the waiting local hidden PowerShell prompt.
   Never put it in a command, .env, source, website or chat; never send a screenshot
   of the displayed key. Hardware/watch-only accounts cannot export a key this way.
4. The offline helper checks the derived address against the exact keeper, then
   writes an encrypted Ethereum JSON keystore using ethers Wallet.encrypt:
   https://docs.ethers.org/v6/api/wallet/#Wallet-encrypt . No RPC, signing, provider
   or network call is used. Output is secrets/keeper-export/keeper.keystore.json,
   with a Windows directory ACL limited to the current user. The directory is
   ignored by Git and excluded from the Netlify publish allowlist/runtime package.
5. Keep the password separately and clear the copied private key from the clipboard.
   Report only that the export succeeded; do not attach the key/keystore/password
   to chat. Later transfer the encrypted file over the verified SSH connection and
   enter the password directly on the VPS without agent-visible command arguments.

Existing exports are never overwritten. Use -OutputDirectory with a new empty
local directory for another attempt if needed. Raw key/password material exists
temporarily in process memory and a local child-process stdin pipe; it is not
written to disk, command history, argv, environment or logs. Memory-zeroization
is not guaranteed by .NET/JavaScript and a compromised Windows account can still
read/use local credentials. The script clears references/BSTR buffers where possible.

This prepares credentials only; it does not start the keeper, enable real funds,
deploy an arena or bypass SEC-03/04. Deployment address/block, the release decision
and remaining readiness conditions must be resolved separately.

Validation used only disposable test material: real encrypt/decrypt round trip,
wrong password/account, weak password, overwrite rejection and sanitized CLI
failure. A Windows PowerShell 5.1 wizard exercise confirmed hidden-input plumbing,
wrong-account rejection with no keystore file and an owner-only directory ACL.
No real keeper secret was read or generated during these checks.

## VPS password entry

The owner subsequently authorized and completed SSH transfer of the encrypted
keystore to /etc/chog-arena/keeper.keystore.json (root:root 0600). No password or
decrypted private key was transferred through chat or agent tools. The server's
private operator directory holds the password-entry helper. Run it only from the
owner's ordinary SSH terminal with a TTY, never through an agent command:

`ssh -tt -i "$env:USERPROFILE\.ssh\chog-beauty-arena-vps-72.56.98.23" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes root@72.56.98.23 python3 /root/chog-keeper-import/set-keeper-password.py`

Enter the password created for the JSON (not the Rabby unlock password). Python
getpass hides input. A local bounded pipe passes it to an offline ethers process
which decrypts and checks the exact keeper address without RPC/signing. Only after
validation does the helper exclusively create /etc/chog-arena/keeper.password,
root-only 0600. It refuses to overwrite an existing password file, rejects a
non-interactive terminal and does not print secrets/errors from cryptography.
Systemd LoadCredential will read these two private files for the keeper. Root
compromise can use both; encryption at rest is not protection from full host
control. This still does not enable/start the keeper or deploy the arena.

The helper's disposable test covers an actual Unicode-password unlock, wrong
password, correct password for a wrong keeper address, exclusive file creation,
preserved contents on overwrite rejection and POSIX 0600 permissions.

On 22 October 2026 (Moscow), the owner completed this terminal step. Read-only
SSH checks found both files owned by root:root with mode 0600. The agent did not
read the password or repeat decryption. See security/keeper-credentials.json.
The web service remains active and keeper inactive: no arena address/deployment
block is configured and the live-release guard remains closed. Do not repeat the
password helper: it intentionally refuses to overwrite the installed file.
