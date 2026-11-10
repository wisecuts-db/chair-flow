#!/usr/bin/env python3
"""
Add someone to TestFlight for ShopBoss as an external tester and give them the latest build.

External testers can be anyone (no App Store Connect account needed). Apple reviews the
first build sent to external testers ("Beta App Review", usually under a day); later builds
are typically available right away.

Env: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, APP_ID, TESTER_EMAIL, TESTER_FIRST, TESTER_LAST, GROUP_NAME
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ios_credentials import Apple, API  # noqa: E402
import requests  # noqa: E402


def main():
    key_pem = open(os.environ['ASC_KEY_PATH'], 'rb').read()
    apple = Apple(key_pem, os.environ['ASC_KEY_ID'].strip(), os.environ['ASC_ISSUER_ID'].strip().lower())
    apple.individual = False
    app_id = os.environ['APP_ID']
    email = os.environ['TESTER_EMAIL'].strip().lower()
    first = os.environ.get('TESTER_FIRST', '').strip() or email.split('@')[0]
    last = os.environ.get('TESTER_LAST', '').strip() or 'Tester'
    group_name = os.environ.get('GROUP_NAME', '').strip() or 'Testers'

    # 1. External group
    groups = apple.call('GET', f'/apps/{app_id}/betaGroups?limit=200').get('data', [])
    print('Groups:', ', '.join(f"{g['attributes']['name']} ({'internal' if g['attributes'].get('isInternalGroup') else 'external'})" for g in groups) or 'none')
    group = next((g for g in groups if g['attributes']['name'] == group_name and not g['attributes'].get('isInternalGroup')), None)
    if not group:
        group = apple.call('POST', '/betaGroups', json={'data': {
            'type': 'betaGroups', 'attributes': {'name': group_name},
            'relationships': {'app': {'data': {'type': 'apps', 'id': app_id}}}}})['data']
        print('Created external group', group_name)
    gid = group['id']

    # 2. Tester (create, or reuse if they already exist)
    found = apple.call('GET', f'/betaTesters?filter[email]={email}&limit=5').get('data', [])
    if found:
        tid = found[0]['id']
        apple.call('POST', f'/betaGroups/{gid}/relationships/betaTesters', json={'data': [{'type': 'betaTesters', 'id': tid}]})
        print('Tester already existed; added to', group_name)
    else:
        tid = apple.call('POST', '/betaTesters', json={'data': {
            'type': 'betaTesters',
            'attributes': {'email': email, 'firstName': first, 'lastName': last},
            'relationships': {'betaGroups': {'data': [{'type': 'betaGroups', 'id': gid}]}}}})['data']['id']
        print('Added tester to', group_name)

    # 3. Latest build into the group, and submit it for Beta App Review if needed
    builds = apple.call('GET', f'/builds?filter[app]={app_id}&sort=-uploadedDate&limit=1').get('data', [])
    if not builds:
        print('No builds yet.'); return
    b = builds[0]
    print('Latest build:', b['attributes'].get('version'), b['attributes'].get('processingState'))
    apple.call('POST', f'/betaGroups/{gid}/relationships/builds', json={'data': [{'type': 'builds', 'id': b['id']}]})
    print('Build added to', group_name)

    detail = apple.call('GET', f"/builds/{b['id']}/buildBetaDetail").get('data', {})
    state = detail.get('attributes', {}).get('externalBuildState')
    print('External testing state:', state)
    if state in ('READY_FOR_BETA_SUBMISSION', None):
        h = {'Authorization': f'Bearer {apple_token(apple)}', 'Content-Type': 'application/json'}
        r = requests.post(API + '/betaAppReviewSubmissions', headers=h, timeout=60, json={'data': {
            'type': 'betaAppReviewSubmissions',
            'relationships': {'build': {'data': {'type': 'builds', 'id': b['id']}}}}})
        if r.status_code < 300:
            print('Submitted build for Beta App Review. Apple usually approves within a day; the tester gets an email invite then.')
        else:
            print('Could not submit for Beta App Review yet:', r.status_code, r.text[:600])
            print('Fill in TestFlight > Test Information (contact email, beta description, sign-in details) in App Store Connect, then run this again.')
    elif state in ('BETA_APPROVED', 'IN_BETA_TESTING'):
        print('Build already approved for external testing; the tester gets an email invite now.')
    else:
        print('Build is', state, '- the invite goes out once Apple finishes.')


def apple_token(apple):
    from ios_credentials import token
    return token(*apple.args, individual=False)


if __name__ == '__main__':
    main()
