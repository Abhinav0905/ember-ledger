"""Create root GitHub Pages entry points that share the dist assets."""
from pathlib import Path
import hashlib
import re
root=Path(__file__).resolve().parents[1]
for name in ['index.html','pitch.html','method.html','validation.html','evidence.html']:
    content=(root/'dist'/name).read_text()
    # Tie cached scripts and styles to their actual bytes on every page.
    def version_asset(match):
        asset=match.group('asset')
        digest=hashlib.sha256((root/'dist'/asset).read_bytes()).hexdigest()[:12]
        return match.group('prefix')+asset+'?v='+digest+'"'
    content=re.sub(r'(?P<prefix>(?:src|href)=")(?P<asset>[^"/?]+\.(?:js|css))(?:\?v=[^"]*)?"',version_asset,content)
    (root/'dist'/name).write_text(content)
    (root/name).write_text(content.replace('<head>', '<head><base href="./dist/">',1))
(root/'.nojekyll').write_text('')
print('Prepared five root entry points and .nojekyll.')
