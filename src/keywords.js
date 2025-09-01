// Minimal keyword extractor without external NLP deps

const STOPWORDS = new Set(`a,about,above,after,again,against,all,am,an,and,any,are,aren't,as,at,be,because,been,before,being,below,between,both,but,by,can't,cannot,could,couldn't,did,didn't,do,does,doesn't,doing,don't,down,during,each,few,for,from,further,had,hadn't,has,hasn't,have,haven't,having,he,he'd,he'll,he's,her,here,here's,hers,herself,him,himself,his,how,how's,i,i'd,i'll,i'm,i've,if,in,into,is,isn't,it,it's,its,itself,let's,me,more,most,mustn't,my,myself,no,nor,not,of,off,on,once,only,or,other,ought,our,ours,ourselves,out,over,own,same,shan't,she,she'd,she'll,she's,should,shouldn't,so,some,such,than,that,that's,the,their,theirs,them,themselves,then,there,there's,these,they,they'd,they'll,they're,they've,this,those,through,to,too,under,until,up,very,was,wasn't,we,we'd,we'll,we're,we've,were,weren't,what,what's,when,when's,where,where's,which,while,who,who's,whom,why,why's,with,won't,would,wouldn't,you,you'd,you'll,you're,you've,your,yours,yourself,yourselves`.split(',').map(s=>s.trim()));

export function extractKeywordsFromHeadlines(headlines, { minLength = 4, max = 10 } = {}) {
  const freq = new Map();
  for (const h of headlines) {
    const words = (h || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    for (let w of words) {
      if (w.length < minLength) continue;
      if (STOPWORDS.has(w)) continue;
      // de-pluralize simple case
      if (w.endsWith('s') && w.length > 4) w = w.slice(0, -1);
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, max).map(([w]) => w);
}

