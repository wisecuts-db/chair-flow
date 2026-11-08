#!/usr/bin/env python3
"""
Create (once) and reuse the iOS App Store signing credentials for Chair Flow,
using only an App Store Connect API key. No Mac or Apple ID login needed.

First run:
  * generates a private key + certificate request
  * asks Apple for an Apple Distribution certificate
  * asks Apple for an App Store provisioning profile for the bundle ID
  * stores the certificate+key ENCRYPTED (key derived from the ASC API key secret)
    in mobile/credentials/, so later runs reuse it instead of making new certificates

Every run:
  * decrypts the certificate into a temporary .p12 and writes credentials.json
    for EAS (credentialsSource: local)
  * makes a new provisioning profile if the stored one is gone or expired

Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, BUNDLE_ID
Prints "CHANGED" on stdout's last line when files in mobile/credentials/ were (re)written.
"""
import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sys
import time

import requests
from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

API = 'https://api.appstoreconnect.apple.com/v1'
CLOCK_OFFSET = 0  # seconds to add to local time to match Apple's clock
HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
STORE = os.path.join(MOBILE, 'credentials')
ENC_P12 = os.path.join(STORE, 'distribution.p12.enc')
PROFILE = os.path.join(STORE, 'appstore.mobileprovision')
META = os.path.join(STORE, 'meta.json')
TMP_P12 = os.path.join(MOBILE, 'dist-cert.p12')          # gitignored
CREDS_JSON = os.path.join(MOBILE, 'credentials.json')    # gitignored


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(key_pem, key_id, issuer, individual=False):
    key = serialization.load_pem_private_key(key_pem, password=None)
    header = {'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}
    now = int(time.time()) + CLOCK_OFFSET - 60   # backdate a minute to tolerate clock skew
    payload = {'iat': now, 'exp': now + 15 * 60, 'aud': 'appstoreconnect-v1'}
    payload.update({'sub': 'user'} if individual else {'iss': issuer})
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}".encode()
    der = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
    return f"{signing_input.decode()}.{b64url(sig)}"


class Apple:
    def __init__(self, key_pem, key_id, issuer):
        self.args = (key_pem, key_id, issuer)
        self.individual = None   # decided on first call

    def call(self, method, path, **kw):
        modes = [self.individual] if self.individual is not None else [False, True]
        for individual in modes:
            h = {'Authorization': f'Bearer {token(*self.args, individual=individual)}', 'Content-Type': 'application/json'}
            r = requests.request(method, API + path, headers=h, timeout=60, **kw)
            if r.status_code != 401:
                if self.individual is None:
                    self.individual = individual
                    print('Signed in to App Store Connect with a', 'individual key' if individual else 'team key')
                break
        if r.status_code >= 400:
            sys.exit(f'Apple API {method} {path} failed ({r.status_code}): {r.text[:800]}')
        return r.json() if r.text else {}


def fernet(key_pem):
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(b'chairflow-ios-cred:' + key_pem.strip()).digest()))


def main():
    key_pem = open(os.environ['ASC_KEY_PATH'], 'rb').read()
    key_id = re.sub(r'\s', '', os.environ['ASC_KEY_ID'])
    issuer = re.sub(r'\s', '', os.environ['ASC_ISSUER_ID'])
    # Format checks (values are never printed).
    print('Key ID format:', 'ok' if re.fullmatch(r'[A-Z0-9]{10}', key_id) else f'UNEXPECTED (length {len(key_id)}, expected 10 capital letters/digits)')
    print('Issuer ID format:', 'ok' if re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', issuer.lower()) else f'UNEXPECTED (length {len(issuer)}, expected a 36-character ID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)')
    apple = Apple(key_pem, key_id, issuer.lower())
    pub = serialization.load_pem_private_key(key_pem, None).public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    print('Key fingerprint (safe to share):', hashlib.sha256(pub).hexdigest()[:12])
    # Apple's .p8 carries its public key too; if it doesn't match the private part, the paste was altered.
    pk = serialization.load_pem_private_key(key_pem, None)
    raw_pub = pk.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    der = serialization.load_pem_private_key(key_pem, None).private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pem_body = b''.join(l for l in key_pem.splitlines() if not l.startswith(b'-----'))
    original = base64.b64decode(pem_body)
    if raw_pub[1:] in original or raw_pub in original:
        print('Key self-check: ok (private and public parts match)')
    elif b'\x03\x42\x00\x04' in original:
        sys.exit('Key self-check FAILED: the pasted ASC_KEY_P8 text was changed while copying (a letter or symbol differs from Apple\'s file).')
    else:
        print('Key self-check: file has no public part to compare')
    # Match Apple's clock.
    global CLOCK_OFFSET
    from email.utils import parsedate_to_datetime
    r0 = requests.get(API + '/apps', timeout=60)
    if r0.headers.get('Date'):
        apple_now = parsedate_to_datetime(r0.headers['Date']).timestamp()
        CLOCK_OFFSET = int(apple_now - time.time())
        print(f'Clock difference with Apple: {CLOCK_OFFSET} seconds')
    # Probe with a harmless read; new keys can take a few minutes to start working.
    for attempt in range(3):
        codes = {}
        for individual in (False, True):
            h = {'Authorization': f'Bearer {token(key_pem, key_id, issuer.lower(), individual)}'}
            codes['individual' if individual else 'team'] = requests.get(API + '/apps?limit=1', headers=h, timeout=60).status_code
        print(f'Sign-in test {attempt + 1}:', codes)
        if 200 in codes.values():
            apple.individual = codes['team'] != 200
            break
        time.sleep(60)
    else:
        sys.exit('Apple rejected the API key every time. The Key ID, Issuer ID and .p8 file must all come from the same, active key.')
    bundle = os.environ['BUNDLE_ID']
    f = fernet(key_pem)
    os.makedirs(STORE, exist_ok=True)
    changed = False
    meta = json.load(open(META)) if os.path.exists(META) else {}

    # ---- 1. Distribution certificate (reuse if still valid on Apple's side) ----
    cert_ok = False
    if os.path.exists(ENC_P12) and meta.get('certificate_id'):
        try:
            p12_bytes = f.decrypt(open(ENC_P12, 'rb').read())
            found = apple.call('GET', f"/certificates?filter[id]={meta['certificate_id']}")
            cert_ok = bool(found.get('data')) and dt.date.fromisoformat(meta['certificate_expires'][:10]) > dt.date.today() + dt.timedelta(days=7)
        except Exception as e:  # wrong key or corrupt file: make a new one
            print(f'Stored certificate unusable ({e}); creating a new one.')
            cert_ok = False

    if not cert_ok:
        print('Creating Apple Distribution certificate…')
        pkey = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        csr = (x509.CertificateSigningRequestBuilder()
               .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Chair Flow CI'),
                                        x509.NameAttribute(NameOID.EMAIL_ADDRESS, 'ci@chairflow.app')]))
               .sign(pkey, hashes.SHA256()))
        csr_b64 = base64.b64encode(csr.public_bytes(serialization.Encoding.DER)).decode()
        res = apple.call('POST', '/certificates', json={'data': {'type': 'certificates', 'attributes': {
            'certificateType': 'DISTRIBUTION', 'csrContent': csr_b64}}})
        data = res['data']
        cert = x509.load_der_x509_certificate(base64.b64decode(data['attributes']['certificateContent']))
        p12_bytes = make_p12(pkey, cert, b'')  # stored without inner password; outer Fernet layer protects it
        open(ENC_P12, 'wb').write(f.encrypt(p12_bytes))
        meta.update({'certificate_id': data['id'],
                     'certificate_serial': data['attributes'].get('serialNumber'),
                     'certificate_expires': data['attributes'].get('expirationDate') or cert.not_valid_after_utc.isoformat()})
        meta.pop('profile_id', None)  # a new certificate needs a new profile
        changed = True

    # ---- 2. App Store provisioning profile ----
    prof_ok = False
    if os.path.exists(PROFILE) and meta.get('profile_id'):
        found = apple.call('GET', f"/profiles?filter[id]={meta['profile_id']}")
        rows = found.get('data') or []
        prof_ok = bool(rows) and rows[0]['attributes'].get('profileState') == 'ACTIVE'

    if not prof_ok:
        print('Creating App Store provisioning profile…')
        b = apple.call('GET', f'/bundleIds?filter[identifier]={bundle}&limit=200')
        matches = [x for x in b.get('data', []) if x['attributes']['identifier'] == bundle]
        if not matches:
            sys.exit(f'Bundle ID {bundle} is not registered in your Apple Developer account.')
        name = f"Chair Flow App Store {dt.datetime.utcnow():%Y%m%d%H%M%S}"
        res = apple.call('POST', '/profiles', json={'data': {
            'type': 'profiles',
            'attributes': {'name': name, 'profileType': 'IOS_APP_STORE'},
            'relationships': {
                'bundleId': {'data': {'type': 'bundleIds', 'id': matches[0]['id']}},
                'certificates': {'data': [{'type': 'certificates', 'id': meta['certificate_id']}]},
            }}})
        open(PROFILE, 'wb').write(base64.b64decode(res['data']['attributes']['profileContent']))
        meta['profile_id'] = res['data']['id']
        changed = True

    if changed:
        json.dump(meta, open(META, 'w'), indent=2)

    # ---- 3. Hand them to EAS ----
    pw = secrets.token_urlsafe(18)
    key, cert, extra = pkcs12.load_key_and_certificates(p12_bytes, b'')
    open(TMP_P12, 'wb').write(make_p12(key, cert, pw.encode()))
    json.dump({'ios': {
        'provisioningProfilePath': os.path.relpath(PROFILE, MOBILE),
        'distributionCertificate': {'path': os.path.relpath(TMP_P12, MOBILE), 'password': pw},
    }}, open(CREDS_JSON, 'w'), indent=2)
    print('credentials.json written')
    print('CHANGED' if changed else 'UNCHANGED')


def make_p12(key, cert, password):
    if password:
        enc = (serialization.PrivateFormat.PKCS12.encryption_builder()
               .kdf_rounds(50000)
               .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC)
               .hmac_hash(hashes.SHA1())
               .build(password))
    else:
        enc = serialization.NoEncryption()
    return pkcs12.serialize_key_and_certificates(b'Chair Flow Distribution', key, cert, None, enc)


if __name__ == '__main__':
    main()
