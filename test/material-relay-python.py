"""Fictional files only; run python3 test/material-relay-python.py."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('relay', Path(__file__).parents[1] / 'scripts/material-relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        collect = self.root / 'collect'
        text = collect / 'SYN101/text/one.txt'
        raw = collect / 'SYN101/raw/one.pdf'
        text.parent.mkdir(parents=True)
        raw.parent.mkdir(parents=True)
        text.write_text('Fictional safety stock reduces shortages.')
        raw.write_bytes(b'fictional raw bytes')
        self.text, self.raw = text, raw
        self.entry = {'course': 'SYN101', 'topic_id': 1, 'title': 'Fictional lesson', 'text_path': str(text),
                      'raw_path': str(raw), 'text_sha256': relay.file_digest(text),
                      'source_sha256': relay.file_digest(raw), 'stages': {'extraction': {'status': 'done', 'verified_at': 1791979200}}}
        self.write('.material-delivery.json', {'entries': {'one': self.entry}})
        self.write('.manifest.json', {'courses': {'SYN101': {'items': [{'id': 1, 'title': 'Fictional lesson'}]}}})
        self.write('.fetched.json', {'1': {'revisions': {'observed': {'course': 'SYN101', 'term_id': 'test'}}}})
        self.courses = [{'id': 'fictional', 'code': 'SYN101', 'term_id': 'test'}]

    def write(self, name, value):
        (self.root / 'collect' / name).write_text(json.dumps(value))

    def inventory(self):
        return relay.inventory(self.root, 'test', self.courses)

    def test_verified_only_and_stable_identity(self):
        records, skips = self.inventory()
        self.assertEqual(len(records), 1)
        self.assertFalse(skips)
        self.assertIsNone(records[0]['import_source']['source_checked_at'])
        self.raw.write_bytes(b'changed without extraction')
        self.assertEqual(self.inventory()[1], {'source_hash_mismatch': 1})

    def test_scope_pending_missing_and_escape(self):
        self.assertEqual(relay.inventory(self.root, 'other-term', self.courses)[0], [])
        self.entry['stages']['extraction']['status'] = 'pending'
        self.write('.material-delivery.json', {'entries': {'one': self.entry}})
        self.assertEqual(self.inventory()[1], {'extraction_pending': 1})
        self.entry['stages']['extraction']['status'] = 'done'
        outside = self.root / 'private.txt'
        outside.write_text('must not be published')
        self.entry['text_path'] = str(outside)
        self.write('.material-delivery.json', {'entries': {'one': self.entry}})
        self.assertEqual(self.inventory()[1], {'source_path_outside_course': 1})

    def test_pdf_layout_controls_are_normalized_after_hash_verification(self):
        self.text.write_bytes(b'Line one\x0bLine two\x0cMissing glyph: \x00')
        self.entry['text_sha256'] = relay.file_digest(self.text)
        self.write('.material-delivery.json', {'entries': {'one': self.entry}})
        records, skips = self.inventory()
        self.assertFalse(skips)
        self.assertEqual(records[0]['text'], 'Line one\nLine two\n\nMissing glyph: \ufffd')
        self.assertEqual(records[0]['import_source']['content_sha256'], relay.digest(records[0]['text'].encode()))

    def test_next_semester_cannot_populate_previous_term(self):
        self.write('.fetched.json', {'1': {'revisions': {'observed': {'course': 'SYN101', 'term_id': 'next-term'}}}})
        self.assertEqual(self.inventory()[1], {'source_term_or_course_unconfirmed': 1})

    def test_lost_response_recovers_exact_receipt_and_next_run_is_noop(self):
        class Fake:
            config = {'workspace_id': 'fictional_owner'}
            rows = []
            receipts = {}
            fail = True
            def call(client, packet):
                if packet['op'] == 'status':
                    return {'ok': True, 'workspace_id': client.config['workspace_id'], 'courses': self.courses, 'records': client.rows}
                if packet['op'] == 'receipt':
                    return client.receipts[packet['data']['operation_id']]
                receipt = {'operation_id': packet['operation_id'], 'operation': 'materials.put',
                           'resource_id': packet['data']['id'], 'revision': packet['expected_revision'] + 1,
                           'request_hash': relay.digest(relay.encoded({'op': 'materials.put', 'data': packet['data'], 'expectedRevision': packet['expected_revision']}))}
                client.receipts[packet['operation_id']] = {'ok': True, 'receipt': receipt}
                client.rows = [{**packet['data'], 'revision': receipt['revision']}]
                if client.fail:
                    client.fail = False
                    raise relay.RelayError('network_unavailable_pending_preserved')
                return client.receipts[packet['operation_id']]
        client = Fake()
        state = self.root / 'state.json'
        with self.assertRaises(relay.RelayError):
            relay.sync(client, state, self.root, 'test')
        self.assertIn('pending', relay.private_read(state))
        result = relay.sync(client, state, self.root, 'test')
        self.assertEqual(result['recovered'], 1)
        self.assertEqual(result['unchanged'], 1)
        self.assertEqual(result['saved'], 0)
        self.assertNotIn('pending', relay.private_read(state))
        self.assertEqual(state.stat().st_mode & 0o077, 0)


if __name__ == '__main__':
    unittest.main()
