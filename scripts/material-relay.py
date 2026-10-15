#!/usr/bin/env python3
"""Publish verified collector outputs with a course-only Sidekick credential.

Standard library only. No portal login, scraping, AI, or personal Bridge API.
All configuration, pending packets and logs must stay outside this repository.
"""
import argparse
import collections
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request


class RelayError(Exception):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def private_read(path):
    p = Path(path)
    if p.is_symlink() or p.stat().st_mode & 0o077 or p.stat().st_uid != os.getuid():
        raise RelayError('private_file_permissions_required')
    return read_json(p)


def read_json(path):
    with open(path, 'rb') as stream:
        raw = stream.read(16000001)
    if len(raw) > 16000000:
        raise RelayError('local_metadata_too_large')
    return json.loads(raw)


def atomic_save(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.relay-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def iso(value):
    if isinstance(value, (int, float)):
        date = dt.datetime.fromtimestamp(value, dt.timezone.utc)
    else:
        date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            raise RelayError('source_time_missing_timezone')
    return date.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def file_digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def safe_file(value, base):
    path = Path(value)
    base = base.resolve()
    if path.is_symlink() or not path.resolve().is_relative_to(base) or not stat.S_ISREG(path.stat().st_mode):
        raise RelayError('source_path_outside_course')
    return path


def inventory(source_root, term, courses, source_term=None):
    """Return only ledger-verified text for current topics in explicitly selected courses."""
    root = Path(source_root).resolve() / 'collect'
    manifest = read_json(root / '.manifest.json')['courses']
    ledger = read_json(root / '.material-delivery.json')['entries']
    fetched = read_json(root / '.fetched.json')
    mapping = collections.defaultdict(list)
    for course in courses:
        if course['term_id'] == term:
            mapping[course['code'].replace(' ', '').upper()].append(course)
    records, skipped = {}, collections.Counter()
    for entry in ledger.values():
        local_course = entry.get('course', '')
        if not re.fullmatch(r'[A-Z]+[0-9]+E?', local_course):
            skipped['invalid_course'] += 1
            continue
        candidates = mapping.get(local_course.removesuffix('E'), [])
        if len(candidates) != 1:
            skipped['course_not_selected_or_ambiguous'] += 1
            continue
        if entry.get('stages', {}).get('extraction', {}).get('status') != 'done':
            skipped['extraction_pending'] += 1
            continue
        topic = str(entry['topic_id'])
        evidence = fetched.get(topic, {}).get('revisions', {})
        observed = evidence.get('observed', evidence)
        if str(observed.get('term_id')) != str(source_term or term) or observed.get('course') != local_course:
            skipped['source_term_or_course_unconfirmed'] += 1
            continue
        items = {str(i['id']): i for i in manifest.get(local_course, {}).get('items', [])}
        if topic not in items:
            skipped['not_in_current_listing'] += 1
            continue
        try:
            text_path = safe_file(entry['text_path'], root / local_course / 'text')
            raw_path = safe_file(entry['raw_path'], root / local_course / 'raw')
            if text_path.stat().st_size > 280000:
                raise RelayError('material_too_large')
            text_bytes = text_path.read_bytes()
            if digest(text_bytes) != entry['text_sha256'] or file_digest(raw_path) != entry['source_sha256']:
                raise RelayError('source_hash_mismatch')
            original_text = text_bytes.decode('utf-8')
            # PDF/slide extraction uses page/line controls. Preserve missing glyphs visibly.
            text = original_text.replace('\x0b', '\n').replace('\x0c', '\n\n').replace('\x00', '\ufffd')
            if not text.strip() or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
                raise RelayError('unsupported_text')
            course_id = candidates[0]['id']
            # Topic ID is stable across revisions; paths and source URLs never leave the Mac.
            key = digest(encoded([local_course, term, topic]))
            material_id = 'relay_' + digest(encoded([course_id, key]))
            revision = fetched.get(topic, {}).get('revisions', {})
            checked = revision.get('checked_at') if revision.get('sha256') == entry['source_sha256'] else None
            record = {'id': material_id, 'course_id': course_id,
                      'title': str(items[topic].get('title') or entry['title'])[:200],
                      'text': text, 'source_kind': 'text_import', 'material_kind': 'course_text',
                      'source_label': 'Collected eLC text' + (' (formatting normalized)' if text != original_text else ''),
                      'import_source': {'key': key, 'content_sha256': digest(text.encode('utf-8')),
                                        'extracted_at': iso(entry['stages']['extraction']['verified_at']),
                                        'source_checked_at': iso(checked) if checked else None}}
            if len(encoded({'op': 'materials.put', 'data': record, 'expectedRevision': 99999})) > 295000:
                raise RelayError('material_too_large')
            if material_id in records and records[material_id] != record:
                raise RelayError('ambiguous_source_revision')
            records[material_id] = record
        except (KeyError, OSError, ValueError, UnicodeError, RelayError) as error:
            skipped[str(error) if isinstance(error, RelayError) else 'source_unavailable'] += 1
    return list(records.values()), dict(skipped)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RelayError('redirect_refused')


class Client:
    def __init__(self, config):
        self.config = config
        url = urllib.parse.urlsplit(config['endpoint'])
        if (url.scheme != 'https' or not url.hostname or url.path != '/material-relay'
                or url.query or url.fragment or url.username or url.password or url.port):
            raise RelayError('invalid_relay_endpoint')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}\.[a-f0-9]{64}', config['credential']):
            raise RelayError('invalid_relay_credential')
        if config['credential'].split('.')[0] != config['workspace_id']:
            raise RelayError('workspace_mismatch')
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, packet):
        request = urllib.request.Request(self.config['endpoint'], data=encoded(packet), method='POST',
                                         headers={'Authorization': 'Bearer ' + self.config['credential'],
                                                  'Content-Type': 'application/json',
                                                  'User-Agent': 'Sidekick-Material-Relay/1.0',
                                                  'Accept': 'application/json'})
        try:
            response = self.opener.open(request, timeout=45)
        except urllib.error.HTTPError as error:
            response = error
        except (OSError, urllib.error.URLError) as error:
            raise RelayError('network_unavailable_pending_preserved') from error
        with response:
            raw = response.read(2000001)
        if len(raw) > 2000000:
            raise RelayError('relay_response_too_large')
        try:
            result = json.loads(raw)
        except ValueError as error:
            raise RelayError('invalid_relay_response') from error
        if not isinstance(result, dict):
            raise RelayError('invalid_relay_response')
        return result


def require_ok(result):
    if result.get('ok') is not True:
        code = result.get('error', 'relay_request_failed')
        raise RelayError(code if re.fullmatch(r'[a-z_]+', str(code)) else 'relay_request_failed')
    return result


def confirm_receipt(result, packet):
    require_ok(result)
    receipt = result.get('receipt', {})
    expected_hash = digest(encoded({'op': 'materials.put', 'data': packet['data'],
                                    'expectedRevision': packet['expected_revision']}))
    if (receipt.get('operation_id') != packet['operation_id']
            or receipt.get('operation') != 'materials.put'
            or receipt.get('resource_id') != packet['data']['id']
            or receipt.get('revision') != packet['expected_revision'] + 1
            or receipt.get('request_hash') != expected_hash):
        raise RelayError('receipt_mismatch_pending_preserved')


def sync(client, state_path, source_root, term, dry_run=False, source_term=None):
    owner = client.config['workspace_id']
    state = private_read(state_path) if Path(state_path).exists() else {'workspace_id': owner}
    if state.get('workspace_id') != owner:
        raise RelayError('state_workspace_mismatch')
    recovered = 0
    if state.get('pending') and not dry_run:
        packet = state['pending']
        result = client.call({'op': 'receipt', 'data': {'operation_id': packet['operation_id']}})
        if result.get('error') == 'receipt_not_found':
            result = client.call(packet)
        confirm_receipt(result, packet)
        state.pop('pending')
        atomic_save(state_path, state)
        recovered = 1
    status = require_ok(client.call({'op': 'status'}))
    if status.get('workspace_id') != owner:
        raise RelayError('response_workspace_mismatch')
    records, skipped = inventory(source_root, term, status['courses'], source_term)
    current = {record['id']: record for record in status['records']}
    summary = {'eligible': len(records), 'skipped': skipped, 'unchanged': 0, 'saved': 0,
               'would_update': 0, 'recovered': recovered, 'conflicts': 0, 'courses': {}}
    for record in records:
        summary['courses'][record['course_id']] = summary['courses'].get(record['course_id'], 0) + 1
        old = current.get(record['id'])
        if old and (old.get('archived') or not old.get('import_source')):
            summary['conflicts'] += 1
            continue
        if old and all(old.get(k) == record[k] for k in ('title', 'source_kind', 'material_kind', 'source_label')) and old['import_source']['content_sha256'] == record['import_source']['content_sha256'] and old['import_source'].get('source_checked_at') == record['import_source']['source_checked_at']:
            summary['unchanged'] += 1
            continue
        if dry_run:
            summary['would_update'] += 1
            continue
        packet = {'op': 'put', 'data': record, 'expected_revision': old['revision'] if old else 0}
        packet['operation_id'] = 'relay_' + digest(encoded([owner, packet]))
        state['pending'] = packet
        atomic_save(state_path, state)
        result = client.call(packet)
        if result.get('status') == 409 and result.get('error') in ('revision_conflict', 'relay_material_locally_changed', 'relay_snapshot_older'):
            state.pop('pending')
            atomic_save(state_path, state)
            summary['conflicts'] += 1
            continue
        confirm_receipt(result, packet)
        state.pop('pending')
        atomic_save(state_path, state)
        summary['saved'] += 1
    state['last_run'] = iso(dt.datetime.now(dt.timezone.utc).isoformat())
    state['summary'] = summary
    if not dry_run:
        atomic_save(state_path, state)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--term', required=True)
    parser.add_argument('--source-term', required=True, help='Exact term identifier in the source collector revision metadata')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    Path(args.state).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(args.state + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'ok': True, 'skipped': 'already_running'}))
            return
        try:
            result = sync(Client(private_read(args.config)), args.state, args.source_root, args.term, args.dry_run, args.source_term)
            print(json.dumps({'ok': True, **result}))
        except Exception as error:
            # Never print URLs, credential values, source paths, text or raw HTTP responses.
            print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, RelayError) else 'local_relay_failed'}))
            sys.exit(1)


if __name__ == '__main__':
    main()
