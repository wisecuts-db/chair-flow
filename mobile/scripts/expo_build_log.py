#!/usr/bin/env python3
"""Print the log of the latest iOS build on Expo, decompressed and readable."""
import gzip, json, subprocess, urllib.request

res = subprocess.run(['eas', 'build:list', '--platform', 'ios', '--limit', '1', '--json', '--non-interactive'],
                     capture_output=True, text=True)
raw = res.stdout[res.stdout.find('['):]
if not raw:
    raise SystemExit('eas build:list failed: ' + res.stderr[-2000:])
b = json.loads(raw)[0]
print('Build', b.get('id'), b.get('status'), (b.get('error') or {}).get('message'))
for url in b.get('logFiles') or []:
    resp = urllib.request.urlopen(url, timeout=60)
    data = resp.read()
    print('log file:', resp.headers.get('Content-Type'), resp.headers.get('Content-Encoding'), data[:4].hex())
    for _ in range(3):
        if data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        elif data[:4] == b'\x28\xb5\x2f\xfd':
            from compression import zstd
            data = zstd.decompress(data)
        elif data[:4] == b'PK\x03\x04':
            import io, zipfile
            z = zipfile.ZipFile(io.BytesIO(data)); data = b''.join(z.read(n) for n in z.namelist())
        elif data[:262][257:262] == b'ustar' or data[:1] == b'\x00':
            import io, tarfile
            t = tarfile.open(fileobj=io.BytesIO(data)); data = b''.join(t.extractfile(m).read() for m in t.getmembers() if m.isfile())
        else:
            break
    out = []
    for ln in data.decode('utf-8', 'replace').splitlines():
        try:
            j = json.loads(ln)
            out.append(f"[{j.get('phase', '')}] {j.get('msg', '')}")
        except Exception:
            out.append(ln)
    phase = [l for l in out if 'INSTALL_DEPENDENCIES' in l]
    print('\n'.join((phase or out)[-150:]))
