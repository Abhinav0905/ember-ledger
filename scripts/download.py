"""Download official FIRMS annual input files. Existing files are left intact."""
import argparse
import concurrent.futures
import shutil
import urllib.request
from pathlib import Path
BASE='https://firms.modaps.eosdis.nasa.gov/data/country/'
BOUNDARY='https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    args=parser.parse_args();args.directory.mkdir(parents=True,exist_ok=True)
    targets=[(BASE+f'{sensor}_{year}_United_States.csv',args.directory/f'{sensor}_{year}_United_States.csv') for sensor,start in [('modis',2001),('viirs-snpp',2012)] for year in range(start,2026)]
    targets.append((BOUNDARY,args.directory/'us-states.json'))
    def download(target):
        url,path=target
        if path.exists():return f'Exists: {path.name}'
        temporary=path.with_suffix(path.suffix+'.part')
        try:
            with urllib.request.urlopen(url,timeout=90) as response, temporary.open('wb') as out:shutil.copyfileobj(response,out)
            temporary.replace(path)
        except Exception:
            temporary.unlink(missing_ok=True);raise
        return f'Downloaded: {path.name}'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(download,targets):print(result,flush=True)
if __name__=='__main__':main()
