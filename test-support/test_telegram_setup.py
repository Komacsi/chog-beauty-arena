import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('telegram_setup', Path(__file__).resolve().parents[1] / 'ops/set-telegram-alerts.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class TelegramSetupTest(unittest.TestCase):
    def test_pair_requires_exact_code_private_human_chat(self):
        def update(text='fresh-code', kind='private', sender=12, bot=False):
            return {'message': {'text': text, 'chat': {'id': 12, 'type': kind}, 'from': {'id': sender, 'is_bot': bot}}}
        self.assertEqual(setup.paired_chat([update()], 'fresh-code'), '12')
        for value in [update(text='wrong'), update(kind='group'), update(sender=99), update(bot=True), {}]:
            self.assertIsNone(setup.paired_chat([value], 'fresh-code'))

    def test_save_is_private_and_exclusive(self):
        with tempfile.TemporaryDirectory(prefix='chog-telegram-test-') as directory:
            path = Path(directory) / 'telegram.json'
            setup.save_credentials(path, 'disposable', '12')
            original = path.read_bytes()
            self.assertEqual(json.loads(original), {'token': 'disposable', 'chatId': '12'})
            if os.name == 'posix':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                setup.save_credentials(path, 'replacement', '99')
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
