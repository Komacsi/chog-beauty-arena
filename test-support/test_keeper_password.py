import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('keeper_password_setup', ROOT / 'ops' / 'set-keeper-password.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class PasswordSetupTest(unittest.TestCase):
    def test_actual_offline_unlock_and_exclusive_private_password_file(self):
        password = 'disposable-пароль-🚀-123'
        with tempfile.TemporaryDirectory(prefix='chog-keeper-pass-fixture-') as directory:
            keystore = Path(directory) / 'disposable.keystore.json'
            # Publicly known key 1, for this isolated fixture only, never a real keeper.
            code = "const fs=require('node:fs');const {Wallet}=require('ethers');(async()=>{const w=new Wallet('0x'+'0'.repeat(63)+'1');fs.writeFileSync(process.argv[1],await w.encrypt(TEST_PASSWORD_LITERAL),{flag:'wx',mode:0o600});console.log(JSON.stringify({address:w.address}));})();".replace('TEST_PASSWORD_LITERAL', json.dumps(password))
            fixture = subprocess.run(['node', '-e', code, str(keystore)], cwd=ROOT, capture_output=True, check=True)
            expected = json.loads(fixture.stdout)['address']
            self.assertEqual(setup.verify_password(keystore, password, ROOT, expected), expected)
            with self.assertRaises(ValueError):
                setup.verify_password(keystore, 'incorrect-password', ROOT, expected)
            with self.assertRaises(ValueError):
                setup.verify_password(keystore, password, ROOT)  # Correct password, wrong production address.
            target = Path(directory) / 'disposable.password'
            self.assertFalse(target.exists())
            setup.save_password(target, password)
            self.assertEqual(target.read_text(encoding='utf8'), password + '\n')
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                setup.save_password(target, 'replacement')
            self.assertEqual(target.read_text(encoding='utf8'), password + '\n')

if __name__ == '__main__':
    unittest.main()
