#!/usr/bin/env python3
"""Read-only: show the latest builds Apple has for ShopBoss and their state."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ios_credentials import Apple  # noqa: E402

apple = Apple(open(os.environ['ASC_KEY_PATH'], 'rb').read(), os.environ['ASC_KEY_ID'], os.environ['ASC_ISSUER_ID'])
apple.individual = False
app = os.environ['APP_ID']
b = apple.call('GET', f'/builds?filter[app]={app}&sort=-uploadedDate&limit=6&include=buildBetaDetail')
details = {x['id']: x['attributes'] for x in b.get('included', []) if x['type'] == 'buildBetaDetails'}
for x in b.get('data', []):
    a = x['attributes']
    bd = details.get((x.get('relationships', {}).get('buildBetaDetail', {}).get('data') or {}).get('id'), {})
    print(f"build {a.get('version')}: {a.get('processingState')} uploaded {a.get('uploadedDate')} "
          f"internal={bd.get('internalBuildState')} external={bd.get('externalBuildState')}")
