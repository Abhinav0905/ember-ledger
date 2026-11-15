"""Create root GitHub Pages entry points that share the dist assets."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
for name in ['index.html','pitch.html','method.html','validation.html','evidence.html']:
    content=(root/'dist'/name).read_text()
    (root/name).write_text(content.replace('<head>', '<head><base href="./dist/">',1))
(root/'.nojekyll').write_text('')
print('Prepared five root entry points and .nojekyll.')
