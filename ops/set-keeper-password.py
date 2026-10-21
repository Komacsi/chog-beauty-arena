#!/usr/bin/env python3
"""Operator-run hidden password entry on the VPS. No service start or RPC."""
import getpass
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

KEEPER = '0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908'
KEYSTORE = Path('/etc/chog-arena/keeper.keystore.json')
PASSWORD_FILE = Path('/etc/chog-arena/keeper.password')
RUNTIME = Path('/opt/chog-arena')
NODE_VERIFY = r'''
const fs = require('node:fs');
const {Wallet} = require(process.argv[1]);
const chunks = []; let size = 0;
process.stdin.on('data', chunk => { size += chunk.length; if (size > 4096) process.exit(1); chunks.push(chunk); });
process.stdin.on('end', async () => {
  try {
    const password = Buffer.concat(chunks).toString('utf8');
    const wallet = await Wallet.fromEncryptedJson(fs.readFileSync(process.argv[2], 'utf8'), password);
    if (wallet.address.toLowerCase() !== process.argv[3].toLowerCase()) process.exit(1);
    process.stdout.write(JSON.stringify({address:wallet.address}));
  } catch { process.exitCode = 1; }
});
'''

def verify_password(keystore, password, runtime=RUNTIME, expected=KEEPER, node='node'):
    if not password or len(password.encode('utf8')) > 4096:
        raise ValueError('Invalid password length')
    try:
        result = subprocess.run(
            [node, '-e', NODE_VERIFY, str(Path(runtime) / 'node_modules' / 'ethers'), str(keystore), expected],
            input=password.encode('utf8'), capture_output=True, timeout=90, check=False)
        if result.returncode != 0:
            raise ValueError('Cannot unlock the keeper keystore with this password')
        address = json.loads(result.stdout)['address']
        if address.lower() != expected.lower():
            raise ValueError('Keystore belongs to another account')
        return address
    except (OSError, subprocess.SubprocessError, KeyError, json.JSONDecodeError):
        raise ValueError('Cannot validate the keeper keystore; no secret details are logged') from None

def save_password(destination, password):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(destination, flags, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(password.encode('utf8') + b'\n')
        output.flush()
        os.fsync(output.fileno())

def main():
    if len(sys.argv) != 1 or os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('Run as root on the VPS without arguments')
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise ValueError('Use your own SSH terminal with -tt; hidden interactive input is required')
    info = KEYSTORE.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Keystore must be a regular root-owned private file (0600)')
    if os.path.lexists(PASSWORD_FILE):
        raise ValueError('Password file already exists; refusing to overwrite it')
    print('Keeper:', KEEPER)
    print('Enter the password created for the JSON keystore. Input is hidden.')
    password = getpass.getpass('Keystore password: ')
    try:
        address = verify_password(KEYSTORE, password)
        save_password(PASSWORD_FILE, password)
    finally:
        password = ''  # Immutable process memory cannot be guaranteed zeroized.
    print('Credential verified for', address)
    print('Password saved root-only (0600). Keeper was NOT started; no transactions sent.')

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nCancelled; keeper was not started.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Do not print exceptions from cryptography, input or subprocesses.
        print('Setup failed. Check private keystore, password, Node runtime and that the password file does not already exist. No secret details are logged.', file=sys.stderr)
        sys.exit(1)
