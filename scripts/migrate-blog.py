"""Fetch the owner's public Hexo archive into a reviewable seed (never overwrite live data).
Requires: pip install beautifulsoup4 markdownify
Run: python scripts/migrate-blog.py
"""
import concurrent.futures, hashlib, json, re, subprocess, urllib.parse
from pathlib import Path
from bs4 import BeautifulSoup
from markdownify import markdownify
BASE='https://tcmiku.github.io/'
def fetch(url):
    return subprocess.check_output(['curl','--fail','-Ls','--max-time','45','--retry','2',url]).decode()
tree=json.loads(fetch('https://api.github.com/repos/tcmiku/tcmiku.github.io/git/trees/master?recursive=1'))
paths=[x['path'] for x in tree['tree'] if re.match(r'^\d{4}/\d{2}/\d{2}/.+/index.html$',x['path'])]
def convert(path):
    url=BASE+urllib.parse.quote(path.removesuffix('index.html'))
    soup=BeautifulSoup(fetch(url),'html.parser'); article=soup.select_one('#article-container')
    if not article: raise ValueError('Missing article: '+url)
    for figure in article.select('figure.highlight'):
        code=figure.select_one('td.code')
        if code:
            pre=soup.new_tag('pre');pre.string=code.get_text('\n');figure.replace_with(pre)
    for el in article.select('[href], [src], [data-lazy-src]'):
        for attr in ['href','src']:
            value=el.get('data-lazy-src') if attr=='src' and el.get('data-lazy-src') else el.get(attr)
            if value: el[attr]=urllib.parse.urljoin(url,value)
    text=markdownify(str(article),heading_style='ATX').strip()
    cats=[x.get_text(strip=True) for x in soup.select('#post-meta a[href*="/categories/"]')]
    tags=[x.get_text(strip=True) for x in soup.select('.tag_share a[href*="/tags/"]')]
    return dict(id='post-'+hashlib.sha256(path.encode()).hexdigest()[:16],title=soup.select_one('h1').get_text(strip=True),date=soup.select_one('time')['datetime'][:10],category=' / '.join(cats) or '随笔',tags=list(dict.fromkeys(tags)),summary=article.get_text(' ',strip=True)[:180],body=text,status='published',sourceUrl=url)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: posts=list(pool.map(convert,paths))
# Point cross-article links at the migrated archive, preserving external references.
for post in posts:
    for target in posts:
        for old in [target['sourceUrl'], urllib.parse.unquote(target['sourceUrl'])]:
            post['body']=post['body'].replace(']('+old+')', '](/blog?id='+target['id']+')')
posts.sort(key=lambda x:x['date'],reverse=True)
out=Path(__file__).resolve().parent.parent/'data/blog-seed.json'
out.write_text(json.dumps({'posts':posts},ensure_ascii=False,indent=2)+'\n')
print(f'Migrated {len(posts)} articles; {sum(len(p["body"]) for p in posts)} characters → {out}')
