import { useState, useEffect, useRef } from 'react'
import { API_BASE, cleanImageUrl } from '../hooks/useBooks'
import { fetchGBCover } from '../components/BookCard'

const HARD_BLOCK = ['boxed set','box set','collection','complete works','complete novels','complete stories','volume 1','volume 2','volume 3','vol 1','vol 2','vol 3','vol. 1','vol. 2','vol. 3','part 1','part 2','part 3','hardcover boxed','paperback boxed',]

function normalizeText(v = '') { return String(v).toLowerCase().replace(/\s+/g, ' ').trim() }
function normalizeTitle(v = '') {
  return normalizeText(v).replace(/[^\w\s]/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim()
}
function hasBlockedTitle(title = '') {
  const t = normalizeText(title)
  return !t || HARD_BLOCK.some(x => t.includes(x))
}
function dedupeAndClean(list = []) {
  const seen = new Set(); const out = []
  for (const b of list) {
    const key = normalizeTitle(b?.title || '')
    if (!key || seen.has(key) || hasBlockedTitle(b?.title || '')) continue
    seen.add(key); out.push(b)
  }
  return out
}

// Intent profiles: keywords, search terms, boost words, hard exclusions per genre
const INTENT_PROFILES = {
  romcom: {
    keywords: ['rom com','romcom','romantic comedy','funny romance','chick lit','beach read','beach book','summer read','summer romance','summery','light romance','light-hearted romance','light hearted romance','fun romance','fluffy romance','holiday romance','vacation read','feel good romance','sweet romance','breezy','witty romance','enemies to lovers','fake dating','will they wont they','contemporary romance','romantic comedy novel','seaside','beach holiday'],
    queryExpansion: 'contemporary romantic comedy funny enemies to lovers beach summer vacation feel-good witty banter sweet romance chick lit light-hearted',
    searchTerms: ['contemporary romance funny','romantic comedy novel','beach read romance','chick lit','enemies to lovers','summer romance'],
    hardExclude: ['james bond','spy','noir','thriller','murder','detective','horror','dystopia','war novel','literary fiction','classic literature','philosophy','business','self help','science fiction','fantasy','magic','crime','mystery','dark','death','grief','tragedy','raymond chandler','ian fleming','gabriel garcia marquez','john irving','ernest hemingway','george orwell','franz kafka','cormac mccarthy'],
    titleBoost: ['love','summer','beach','romance','heart','kiss','wed','bride','boyfriend','girlfriend','date','dating','forever','always','almost','holiday','paris','italy','vacation','proposal','wedding','first'],
    descBoost: ['romantic comedy','beach','summer','funny','banter','swoon','enemies to lovers','fake dating','second chance','small town romance','sweet','heartwarming','witty','charming','feel good','laugh','delightful','warm','cozy','quick read','page turner romance'],
  },
  romance: {
    keywords: ['romance','romantic','love story','love novel','heartbreak','emotional romance','sad romance','tragic love','passionate love','intense romance','dramatic romance','historical romance','regency romance','call me by your name','the notebook','outlander','bridgerton'],
    queryExpansion: 'romance love story passionate emotional dramatic relationship sweeping love historical romance regency',
    searchTerms: ['romance novel bestseller','love story fiction','romantic drama'],
    hardExclude: ['james bond','spy thriller','business book','self help','science fiction','horror','dystopia','raymond chandler','ian fleming'],
    titleBoost: ['love','heart','passion','desire','forever','always','never','kiss','embrace','soul','promise','secret','affair'],
    descBoost: ['romance','love','heartbreak','passionate','emotional','relationship','soulmate','forbidden love','second chance','sweeping','epic love'],
  },
  business: {
    keywords: ['sales','marketing','business','branding','persuasion','entrepreneur','entrepreneurship','startup','start-up','customer psychology','copywriting','advertising','negotiation','productivity','leadership','finance','money','career','management','strategy','growth hacking','revenue','b2b','business professional','business book','professional development'],
    queryExpansion: 'business books sales marketing persuasion branding negotiation entrepreneurship leadership productivity strategy management revenue',
    searchTerms: ['sales marketing books','business strategy','persuasion influence book','entrepreneur startup','leadership management'],
    hardExclude: ['harry potter','hobbit','lord of the rings','sherlock','wizard','magic','fantasy','romance','thriller','mystery','horror','love story','james bond','spy','detective','vampire','dragon','fairy','pablo neruda','poetry','poem','dr seuss','children','fairy tale','shadow of the wind','love poem','literary fiction','classic novel'],
    titleBoost: ['marketing','sales','influence','branding','startup','business','negotiation','money','leadership','psychology','habit','productivity','entrepreneur','persuasion','profit','strategy','selling','customer','growth','revenue','million','billion','lean','agile','pitch','brand','market'],
    descBoost: ['business','marketing','sales','revenue','customers','company','entrepreneur','startup','leadership','management','strategy','persuasion','influence','negotiation','productivity','success'],
  },
  thriller: {
    keywords: ['thriller','suspense','twist','crime','murder','killer','investigation','dark thriller','mystery','psychological thriller','noir','detective','whodunit','serial killer','page turner thriller','gripping','one sitting thriller','edge of seat'],
    queryExpansion: 'psychological thriller suspense crime murder investigation dark plot twist gripping one sitting noir detective',
    searchTerms: ['psychological thriller','crime thriller novel','mystery suspense'],
    hardExclude: ['business','marketing','self help','romance novel','chick lit','fantasy magic','science fiction','children'],
    titleBoost: ['gone','girl','missing','dead','kill','murder','secret','lies','dark','shadow','night','silence','fear','danger','suspect','truth','hidden','vanish','disappear','betrayal','silent'],
    descBoost: ['thriller','suspense','murder','investigation','crime','twist','gripping','edge of your seat','page turner','psychological','dark secrets'],
  },
  fantasy: {
    keywords: ['fantasy','magic','dragon','epic','kingdom','mythical','world-building','sword','quest','wizard','witch','fae','sorcery','enchanted','faery','elvish','dark fantasy','high fantasy','epic fantasy','found family fantasy'],
    queryExpansion: 'epic fantasy magic world building mythical quest found family political intrigue adventure dragons wizard fae',
    searchTerms: ['epic fantasy novel','magic fantasy bestseller','high fantasy'],
    hardExclude: ['business','marketing','self help','romance','thriller','crime'],
    titleBoost: ['dragon','magic','kingdom','throne','sword','quest','wizard','witch','shadow','fire','blood','crown','realm','enchant','war','legend','myth','ruin','storm','night','glass'],
    descBoost: ['magic','fantasy','world-building','dragon','quest','kingdom','sorcery','fae','epic','adventure','mythical','enchanted'],
  },
  darkAcademia: {
    keywords: ['dark academia','academia','lyrical prose','elite school','morally complex','intellectual','philosophical','campus novel','boarding school','gothic literary','the secret history vibe'],
    queryExpansion: 'dark academia literary mystery lyrical prose elite school intellectual morally complex gothic campus novel philosophical',
    searchTerms: ['dark academia novel','campus gothic literary','boarding school mystery'],
    hardExclude: ['business','marketing','self help','fantasy magic'],
    titleBoost: ['secret','history','school','college','academy','study','murder','art'],
    descBoost: ['dark academia','academic','campus','lyrical','intellectual','gothic','elite school'],
  },
  historical: {
    keywords: ['historical','ancient','war','rome','victorian','period drama','historical fiction','world war','medieval','tudor','egyptian','greek','roman','renaissance','elizabethan','civil war'],
    queryExpansion: 'historical fiction period drama vivid setting war society strong character ancient rome victorian medieval',
    searchTerms: ['historical fiction bestseller','historical novel','period drama fiction'],
    hardExclude: ['business','marketing','self help','fantasy magic','science fiction'],
    titleBoost: ['ancient','war','rome','queen','king','empire','history','century','world'],
    descBoost: ['historical','period','ancient','war','victorian','medieval','century','era'],
  },
  selfHelp: {
    keywords: ['self help','self-help','habits','mindset','success','personal development','motivation','growth','well-being','mental health book','positive thinking','atomic habits','life improvement'],
    queryExpansion: 'self help personal development habits mindset productivity success psychology growth motivation well-being',
    searchTerms: ['self help bestseller','personal development book','habits mindset'],
    hardExclude: ['romance','thriller','fantasy','horror','science fiction','james bond','harry potter','mystery novel'],
    titleBoost: ['habits','mindset','success','happiness','power','better','think','life','change'],
    descBoost: ['habits','mindset','success','happiness','motivation','growth','well-being','self-improvement'],
  },
  cozy: {
    keywords: ['cozy','cosy','feel good','uplifting','comforting','warm','light hearted','light-hearted','warming','wholesome','charming','gentle','slow burn cozy','quiet book','village','small town'],
    queryExpansion: 'cozy comforting uplifting feel good warm light hearted charming fiction gentle wholesome small town village',
    searchTerms: ['cozy fiction feel good','uplifting novel','wholesome book'],
    hardExclude: ['horror','dark thriller','war novel','gritty noir','dystopia'],
    titleBoost: ['cozy','cosy','warm','home','garden','village','cottage','sweet','little'],
    descBoost: ['cozy','comforting','uplifting','warm','charming','gentle','wholesome','feel good'],
  },
  shortStories: {
    keywords: ['short stories','story collection','anthology','short story','flash fiction'],
    queryExpansion: 'short stories anthology concise storytelling literary collection human connection',
    searchTerms: ['short story collection','fiction anthology'],
    hardExclude: [],
    titleBoost: ['stories','tales','collection','anthology'],
    descBoost: ['short stories','anthology','collection','brief','flash fiction'],
  },
  scifi: {
    keywords: ['science fiction','sci-fi','sci fi','space','stars','planets','planet','astronomy','cosmos','galaxy','galaxies','nebula','solar system','universe','spacecraft','spaceship','outer space','interstellar','intergalactic','dystopia','dystopian','futuristic','robots','ai novel','artificial intelligence fiction','time travel','alien','extraterrestrial','post apocalyptic','cyberpunk','utopia','space opera','hard sci-fi'],
    queryExpansion: 'science fiction space stars planets galaxy cosmos astronomy interstellar dystopia futuristic robots alien time travel cyberpunk space opera',
    searchTerms: ['science fiction space stars','astronomy space novel','sci-fi galaxy cosmos','dystopian novel','alien science fiction'],
    hardExclude: ['business','marketing','self help','romance novel','chick lit','mystery detective','crime noir','historical romance','regency romance','literary fiction classic','play by','george bernard shaw','pygmalion','maisie dobbs','jack ryan','spy thriller','cooking','recipes','shadow of the wind','cemetery of forgotten','cozy mystery','cosy mystery'],
    titleBoost: ['space','star','stars','planet','planets','galaxy','cosmos','universe','nebula','solar','orbit','mars','earth','world','time','future','robot','android','cyber','alien','nova','void','interstellar','odyssey','foundation','dune','hitchhiker','ender'],
    descBoost: ['science fiction','sci-fi','dystopia','futuristic','space','spacecraft','robot','alien','technology','artificial intelligence','galaxy','cosmos','astronomy','planet','orbit','interstellar','extraterrestrial','space opera','post-apocalyptic','cyberpunk'],
  },
  comingOfAge: {
    keywords: ['coming of age','young adult','ya novel','teen','adolescence','identity','growing up','first love','high school','college freshman','family secrets','discovering self','bildungsroman'],
    queryExpansion: 'coming of age young adult identity first love growing up family secrets self discovery adolescence',
    searchTerms: ['coming of age novel','young adult fiction','teen identity'],
    hardExclude: ['business','marketing'],
    titleBoost: ['forever','first','summer','last','almost','everything','always','never'],
    descBoost: ['coming of age','young adult','identity','first love','growing up','family','school','teen'],
  },
  sports: {
    keywords: ['sports','sport','football','soccer','basketball','baseball','cricket','tennis','golf','swimming','cycling','running','marathon','athlete','athletics','olympic','olympics','championship','coach','coaching','game','match','tournament','team','player','fitness','gym','workout','training','competitive','sports biography','sports story','underdog','winning','sportsmanship','sports related','sports book'],
    queryExpansion: 'sports athlete athletic competition team game championship training biography motivational fitness performance underdog winning',
    searchTerms: ['sports biography athlete','sports fiction novel','athletic competition book','team sports story','championship underdog'],
    hardExclude: ['romance novel','fantasy magic','horror','chick lit','mystery detective','business marketing','shakespeare','poetry collection','recipes','cooking'],
    titleBoost: ['game','play','win','champion','sport','field','court','league','ball','race','run','fight','team','coach','athlete','glory','gold','olympic','pitch','arena','stadium'],
    descBoost: ['sport','athlete','team','competition','championship','training','game','match','coach','fitness','performance','underdog','victory','olympic','winning','career','professional athlete'],
  },
  cooking: {
    keywords: ['cooking','cook','cookbook','recipe','recipes','food','cuisine','chef','baking','bake','kitchen','culinary','gastronomy','gourmet','meal','dinner','breakfast','lunch','dessert','pastry','bread','vegetarian','vegan','gluten free','diet','nutrition','healthy eating','meal prep','ingredients','flavor','spice','wine pairing','food book'],
    queryExpansion: 'cookbook recipes food cooking culinary chef baking kitchen cuisine nutrition meal health',
    searchTerms: ['cookbook recipes bestseller','culinary arts food','baking cookbook','healthy eating nutrition','chef memoir food'],
    hardExclude: ['thriller','mystery','horror','romance novel','fantasy magic','science fiction','business strategy','philosophy'],
    titleBoost: ['cook','kitchen','recipe','food','eat','chef','bake','flavor','taste','bread','pasta','spice','dish','meal','plate','table'],
    descBoost: ['recipe','cooking','culinary','chef','kitchen','ingredient','flavor','baking','cuisine','food','nutrition','meal','dish','dietary'],
  },
  education: {
    keywords: ['education','educational','learning','science','scientific','knowledge','physics','chemistry','biology','mathematics','math','history of science','astronomy','cosmology','astrophysics','neuroscience','psychology','sociology','economics','environment','nature','ecology','technology','engineering','medicine','health science','information','textbook','academic','research','nonfiction science','popular science','how things work','explain','stars and planets','space science','telescope','big bang','black hole','dark matter'],
    queryExpansion: 'educational science knowledge learning nonfiction popular science physics biology astronomy cosmos space stars planets history nature technology research academic',
    searchTerms: ['popular science book','astronomy space science book','science nonfiction bestseller','physics cosmology book','biology nature science','astrophysics universe book'],
    hardExclude: ['romance novel','fantasy magic','horror','thriller fiction','chick lit','mystery detective','spy novel','cooking recipes','pygmalion','george bernard shaw'],
    titleBoost: ['science','universe','brain','mind','theory','physics','biology','nature','earth','evolution','genome','cosmos','quantum','brief','history','life','human','world','discovery','explained','astronomy','astrophysics','star','planet','galaxy','black hole','cosmos','telescope','solar','space','hawking','sagan'],
    descBoost: ['science','scientific','research','discovery','knowledge','theory','physics','biology','evolution','technology','academic','study','explains','nonfiction','educational','popular science','astronomy','cosmos','galaxy','planet','orbit','telescope','astrophysics'],
  },
  travel: {
    keywords: ['travel','journey','adventure travel','backpacking','wanderlust','travelogue','travel memoir','around the world','expedition','explore','exploration','country','continent','road trip','hiking','pilgrimage','culture','places','destinations'],
    queryExpansion: 'travel memoir journey adventure exploration travelogue wanderlust road trip culture destinations backpacking expedition',
    searchTerms: ['travel memoir book','adventure travel nonfiction','journey exploration book','travelogue bestseller'],
    hardExclude: ['romance novel','horror','fantasy magic','business strategy','mystery detective','science fiction'],
    titleBoost: ['journey','travel','world','road','way','path','walk','route','across','around','beyond','expedition','adventure','map'],
    descBoost: ['travel','journey','adventure','exploration','culture','destination','world','continent','memoir','wanderlust','backpack','expedition'],
  },
  horror: {
    keywords: ['horror','scary','terrifying','haunted','ghost','supernatural','paranormal','creepy','disturbing','dark horror','gothic horror','monster','demon','possession','occult','evil','nightmare','spine chilling','bone chilling','fear','dread','atmospheric horror'],
    queryExpansion: 'horror scary supernatural ghost haunted paranormal dark gothic atmospheric terrifying dread fear monster occult',
    searchTerms: ['horror novel bestseller','supernatural horror book','gothic horror fiction','paranormal horror'],
    hardExclude: ['romance novel','business marketing','cooking','self help','travel memoir'],
    titleBoost: ['dark','night','dead','death','ghost','haunted','evil','blood','fear','shadow','black','demon','horror','curse','scream','grave'],
    descBoost: ['horror','scary','haunted','supernatural','paranormal','ghost','terrifying','dark','gothic','atmospheric','dread','monster','evil'],
  },
  biography: {
    keywords: ['biography','autobiography','memoir','life story','true story','real life','nonfiction','life of','story of','profile','historical figure','president','politician','scientist leader','artist memoir','musician memoir','celebrity memoir','personal story'],
    queryExpansion: 'biography memoir autobiography true life nonfiction historical figure personal story narrative leader artist',
    searchTerms: ['biography autobiography bestseller','memoir true story nonfiction','life story historical figure'],
    hardExclude: ['fantasy magic','science fiction','horror','romance novel','thriller fiction'],
    titleBoost: ['life','story','memoir','journey','rise','fall','born','becoming','untold','secret','truth','real','true','promise','legacy'],
    descBoost: ['biography','memoir','autobiography','true story','life','nonfiction','journalist','personal','narrative','historical','real person'],
  },
  poetry: {
    keywords: ['poetry','poems','poem','verse','poet','lyrical','haiku','sonnet','spoken word','prose poetry','poetry collection','ode','elegy','anthology poetry'],
    queryExpansion: 'poetry poems verse lyrical poet collection anthology prose poetry spoken word haiku sonnet',
    searchTerms: ['poetry collection bestseller','modern poetry book','poems anthology'],
    hardExclude: ['business marketing','thriller','horror','science fiction','self help'],
    titleBoost: ['poem','poetry','verse','ode','song','hymn','lyric','elegy','sonnet'],
    descBoost: ['poetry','poem','verse','lyrical','poet','collection','anthology','stanza'],
  },
}

// Seed titles for each intent — boost score when found in results
const KNOWN_GOOD_BY_INTENT = {
  romcom: ['the summer i turned pretty','beach read','the hating game','people we meet on vacation','one day in december','in a holidaze','the kiss quotient','to all the boys ive loved before','call me maybe','you had me at hola','the spanish love deception','love theoretically','funny story','happy place','book lovers','act your age eve brown','get a life chloe brown','take a hint dani brown','the worst best man','a lot like adiós','ten things i hate about pinky','the charm offensive','emergency contact','waiting for tom hanks','the flatshare','nick and norah infinite playlist','attachments rainbow rowell','fangirl','eleanor and park','landline','second first impressions','the lucky ones','the right swipe','on the come up','its not summer without you','well never summer'],
  romance: ['outlander','the notebook','me before you','call me by your name','normal people','the time travelers wife','atonement','pride and prejudice','jane eyre','north and south','a walk to remember','the fault in our stars','it ends with us','ugly love','november 9','confess','reminders of him','verity','haunting adeline','icebreaker','from blood and ash','a court of thorns and roses'],
  business: ['influence the psychology of persuasion','thinking fast and slow','never split the difference','the lean startup','zero to one','good to great','atomic habits','the hard thing about hard things','shoe dog','sapiens','blink','outliers','the tipping point','made to stick','contagious','hooked nir eyal','lost and founder','play bigger','crossing the chasm','spin selling','how to win friends and influence people','$100m offers','the e myth revisited','the 4 hour workweek','deep work','start with why','the innovators dilemma','blue ocean strategy','purple cow','all marketers are liars','this is marketing','building a story brand','dotcom secrets','expert secrets'],
  thriller: ['gone girl','the girl with the dragon tattoo','big little lies','the silent patient','the woman in the window','behind closed doors','the husband she knew','i am pilgrim','the firm','the pelican brief','sharp objects','dark places','you gillian flynn','the girl on the train','in the woods tana french','the likeness','faithful place','broken harbour','the good girl mary kubica','what rose forgot'],
  sports: ['open andre agassi','shoe dog phil knight','the boys in the boat','friday night lights','moneyball','seabiscuit','into thin air','the art of fielding','a river runs through it','unbroken laura hillenbrand','born to run','mind gym','the inner game of tennis','wooden on leadership','the big miss','slaughterhouse five','fever pitch','the damned united'],
  cooking: ['salt fat acid heat','the joy of cooking','mastering the art of french cooking','the food lab','plenty ottolenghi','jerusalem ottolenghi','nigella lawson','how to eat nigella lawson','the flavor bible','on food and cooking','cooked michael pollan','the omnivore dilemma','kitchen confidence','baking ina garten','tartine bread','an everlasting meal'],
  education: ['a brief history of time','sapiens yuval noah harari','cosmos carl sagan','the selfish gene','guns germs and steel','the elegant universe','thinking fast and slow','freakonomics','the black swan nassim taleb','the immortal life of henrietta lacks','the gene siddhartha mukherjee','astrophysics for people in a hurry','the body bill bryson','a short history of nearly everything','why we sleep matthew walker'],
  travel: ['into the wild','wild cheryl strayed','eat pray love','a year in provence','under the tuscan sun','in patagonia','the alchemist paulo coelho','on the road jack kerouac','neither here nor there bill bryson','notes from a small island','the geography of bliss','the beach alex garland','shantaram'],
  horror: ['the shining stephen king','it stephen king','dracula bram stoker','frankenstein mary shelley','the haunting of hill house','house of leaves','pet sematary','misery stephen king','american gods neil gaiman','bird box josh malerman','the troop nick cutter'],
  biography: ['becoming michelle obama','the diary of a young girl anne frank','long walk to freedom nelson mandela','steve jobs walter isaacson','educated tara westover','the glass castle jeannette walls','i know why the caged bird sings','born a crime trevor noah','my own words ruth bader ginsburg','when breath becomes air','the immortal life of henrietta lacks','just mercy bryan stevenson'],
  poetry: ['milk and honey rupi kaur','the sun and her flowers rupi kaur','leaves of grass walt whitman','selected poems pablo neruda','ariel sylvia plath','the waste land ts eliot','rumi the masnavi','the prophet kahlil gibran','night sky with exit wounds ocean vuong','still life with bread crumbs'],
}

// Detect primary intent from query keywords; returns primary, secondary, allMatched
function detectIntent(query = '') {
  const q = normalizeText(query)
  const scores = {}
  for (const [intent, profile] of Object.entries(INTENT_PROFILES)) {
    let score = 0
    for (const kw of profile.keywords) {
      if (q.includes(kw)) score += kw.includes(' ') ? (kw.split(' ').length * 3) : 1
    }
    scores[intent] = score
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const primary = sorted[0]?.[1] > 0 ? sorted[0][0] : 'general'
  const secondary = sorted[1]?.[1] > 0 ? sorted[1][0] : null
  const allMatched = sorted.filter(([, s]) => s > 0).map(([i]) => i)
  return { primary, secondary, allMatched, q, scores }
}

function buildExpandedQuery(query = '') {
  const { primary } = detectIntent(query)
  if (primary === 'general') {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(w => w.length > 3)
    return `${query.trim()} ${[...new Set(tokens)].slice(0, 12).join(' ')}`.slice(0, 400)
  }
  return INTENT_PROFILES[primary]?.queryExpansion || query.trim()
}

function isHardExcluded(book, intent) {
  if (!intent || intent === 'general') return false
  const profile = INTENT_PROFILES[intent]
  if (!profile?.hardExclude?.length) return false
  const combined = `${normalizeText(book?.title || '')} ${normalizeText(book?.authors || '')} ${normalizeText(book?.description || book?.summary || book?.overview || '')}`
  return profile.hardExclude.some(ex => combined.includes(ex))
}

function countMatches(text, keywords = []) {
  const t = normalizeText(text); let score = 0
  for (const k of keywords) { if (t.includes(k)) score += k.includes(' ') ? (k.split(' ').length * 2) : 1 }
  return score
}

function scoreBook(book, query, sourceTag = 'unknown') {
  const { primary, secondary, q } = detectIntent(query)
  const profile = INTENT_PROFILES[primary]
  const title = normalizeText(book?.title || '')
  const authors = normalizeText(book?.authors || '')
  const desc = normalizeText(book?.description || book?.summary || book?.overview || book?.genres || '')
  const combined = `${title} ${desc}`
  let score = 0

  // Source weights
  if (sourceTag === 'description') score += 50
  if (sourceTag === 'mood') score += 30
  if (sourceTag === 'search') score += 22
  if (sourceTag === 'similar') score += 12
  if (sourceTag === 'seeded') score += 80

  // Known-good seed match
  const knownGood = KNOWN_GOOD_BY_INTENT[primary] || []
  for (const kg of knownGood) {
    if (title.includes(kg) || kg.includes(title.replace(/[^\w\s]/g, ' ').trim())) { score += 120; break }
  }

  // Query token matching
  if (q && title.includes(q)) score += 60
  if (q && desc.includes(q)) score += 30
  const qTokens = q.split(/\s+/).filter(w => w.length > 3)
  for (const token of qTokens) {
    if (title.includes(token)) score += 10
    if (authors.includes(token)) score += 3
    if (desc.includes(token)) score += 5
  }

  // Intent-specific boosts
  if (profile) {
    score += countMatches(title, profile.titleBoost) * 14
    score += countMatches(desc, profile.descBoost) * 7
  }
  if (secondary && INTENT_PROFILES[secondary]) {
    const sp = INTENT_PROFILES[secondary]
    score += countMatches(title, sp.titleBoost) * 5
    score += countMatches(desc, sp.descBoost) * 3
  }

  // Rating boost
  const avg = Number(book?.average_rating || 0)
  const cnt = Number(book?.rating_count || 0)
  if (avg > 0) score += avg * 3
  if (cnt > 0) score += Math.min(12, Math.log10(cnt + 1) * 3)

  // Noise penalty
  if (title.includes('boxed') || title.includes('collection') || title.includes('complete') || title.includes('volume') || title.includes('vol.')) score -= 30

  // Hard exclusion penalty
  if (primary && INTENT_PROFILES[primary]?.hardExclude) {
    for (const ex of INTENT_PROFILES[primary].hardExclude) {
      if (combined.includes(ex)) { score -= 150; break }
    }
  }

  // General intent: token relevance floor
  if (primary === 'general') {
    const qWords = q.split(/\s+/).filter(w => w.length > 3)
    let tokenHits = 0
    for (const w of qWords) {
      if (title.includes(w)) tokenHits += 4
      if (desc.includes(w)) tokenHits += 2
    }
    if (tokenHits === 0 && qWords.length > 1) score -= 60
    score += Math.min(tokenHits, 40)
  }

  // Relevance gate: zero keyword match for a known intent = likely wrong genre
  if (primary !== 'general' && profile) {
    const titleHits = countMatches(title, profile.titleBoost)
    const descHits = countMatches(desc, profile.descBoost)
    const inKnownGood = knownGood.some(kg => title.includes(kg) || kg.includes(title.replace(/[^\w\s]/g, ' ').trim()))
    if (titleHits === 0 && descHits === 0 && !inKnownGood) score -= 90
  }

  return score
}

function BookCover({ book }) {
  const local = cleanImageUrl(book?.image_url)
  const [src, setSrc] = useState(local || '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const fresh = cleanImageUrl(book?.image_url)
    setSrc(fresh || ''); setFailed(false)
    if (!fresh && book?.title) {
      fetchGBCover(book.title, book?.authors || '').then(gb => { if (gb) setSrc(gb) })
    }
  }, [book?.image_url, book?.title, book?.authors])

  async function handleError() {
    if (failed) return
    setFailed(true)
    const gb = await fetchGBCover(book?.title || '', book?.authors || '')
    if (gb) { setSrc(gb); setFailed(false) }
  }

  if (src && !failed) {
    return <img src={src} alt={book?.title || ''} loading="lazy" onError={handleError} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(114,57,63,0.22)', color: 'rgba(201,168,76,0.35)' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    </div>
  )
}

function BookCard({ book, onOpen }) {
  const [hov, setHov] = useState(false)
  return (
    <div style={{ cursor: 'pointer', position: 'relative' }} onClick={() => onOpen(book)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '2/3', background: 'rgba(114,57,63,0.2)', transform: hov ? 'translateY(-6px)' : 'translateY(0)', transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease', boxShadow: hov ? '0 20px 48px rgba(0,0,0,0.7)' : '0 2px 8px rgba(0,0,0,0.3)' }}>
        <div style={{ width: '100%', height: '100%', transform: hov ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1)' }}>
          <BookCover book={book} />
        </div>
      </div>
      <div style={{ padding: '7px 2px 0' }}>
        <div style={{ fontFamily: 'Montaga,serif', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 2, transform: hov ? 'translateY(-1px)' : 'none', transition: 'transform 0.25s ease' }}>
          {book.title}
        </div>
        <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 300, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {book.authors}
        </div>
        {Number(book.average_rating) > 0 && (
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: 'var(--gold)', marginTop: 2 }}>
            {Number(book.average_rating).toFixed(1)} ★
          </div>
        )}
      </div>
    </div>
  )
}

const EXAMPLES = [
  { label: 'Cosy Mystery', prompt: 'A cosy mystery set in a small English village with a clever amateur detective' },
  { label: 'Epic Fantasy', prompt: 'An epic fantasy with found family, political intrigue and world-building' },
  { label: 'Thriller', prompt: 'A psychological thriller you can finish in one sitting with a twist ending' },
  { label: 'Grief & Healing', prompt: 'An uplifting story about grief and healing that makes you cry and smile' },
  { label: 'Dark Academia', prompt: 'Dark academia with beautiful lyrical prose and morally complex characters' },
  { label: 'Historical Fiction', prompt: 'Vivid historical fiction set in ancient Rome with a strong female protagonist' },
  { label: 'Funny & Absurd', prompt: 'A witty, absurdist comedy with an unreliable narrator and laugh-out-loud moments' },
  { label: 'Short Stories', prompt: 'A beautiful short story collection about loneliness and human connection' },
  { label: 'Coming of Age', prompt: 'A coming of age story about identity, family secrets and first love' },
  { label: 'Crime Noir', prompt: 'A gritty noir crime novel set in 1940s Los Angeles with a morally grey detective' },
  { label: 'Sales & Marketing', prompt: 'A book about sales, marketing and persuasion for business professionals' },
  { label: 'Beach Read', prompt: 'A fun, light-hearted romance perfect for reading on a summer beach holiday' },
]

async function safeJson(res) { try { return await res.json() } catch { return null } }
function toBookArray(data) { return Array.isArray(data) ? data : (data?.books || data?.results || []) }

async function searchByDescription(query, signal) {
  const pool = []
  const { primary } = detectIntent(query)
  const profile = INTENT_PROFILES[primary]
  const expandedQuery = buildExpandedQuery(query)

  function absorb(list, sourceTag) {
    for (const b of toBookArray(list)) {
      if (!isHardExcluded(b, primary)) pool.push({ ...b, _sourceTag: sourceTag })
    }
  }

  // 1) Semantic description
  try {
    const r = await fetch(`${API_BASE}/recommend/description`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: query.trim(), liked_titles: [], saved_titles: [], top_n: 80 }), signal })
    if (r.ok) absorb(await safeJson(r), 'description')
  } catch (e) { if (e?.name === 'AbortError') throw e }

  // 2) Mood / expanded semantic
  try {
    const r = await fetch(`${API_BASE}/recommend/mood`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mood: expandedQuery, top_n: 70, use_llm: true }), signal })
    if (r.ok) absorb(await safeJson(r), 'mood')
  } catch (e) { if (e?.name === 'AbortError') throw e }

  // 3) Direct keyword search
  try {
    const r = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query.trim())}&limit=60`, { signal })
    if (r.ok) absorb(await safeJson(r), 'search')
  } catch (e) { if (e?.name === 'AbortError') throw e }

  // 4) Intent-specific search terms
  if (profile?.searchTerms?.length) {
    const calls = await Promise.allSettled(profile.searchTerms.slice(0, 3).map(term => fetch(`${API_BASE}/search?query=${encodeURIComponent(term)}&limit=40`, { signal }).then(async r => r.ok ? await safeJson(r) : null)))
    for (const item of calls) { if (item.status === 'fulfilled' && item.value) absorb(item.value, 'search') }
  }

  // 5) Seed from known-good titles
  const knownGood = KNOWN_GOOD_BY_INTENT[primary] || []
  if (knownGood.length) {
    const calls = await Promise.allSettled(knownGood.slice(0, 5).map(title => fetch(`${API_BASE}/recommend/title?title=${encodeURIComponent(title)}&top_n=30`, { signal }).then(async r => r.ok ? await safeJson(r) : null)))
    for (const item of calls) { if (item.status === 'fulfilled' && item.value) absorb(item.value, 'seeded') }
  }

  // 6) Similar-book expansion from top seeds
  const topSeeds = dedupeAndClean(pool).map(b => ({ ...b, _seedScore: scoreBook(b, query, b._sourceTag || 'unknown') })).sort((a, b) => b._seedScore - a._seedScore).slice(0, 5)
  if (topSeeds.length) {
    const calls = await Promise.allSettled(topSeeds.map(book => fetch(`${API_BASE}/recommend/title?title=${encodeURIComponent(book.title)}&top_n=30`, { signal }).then(async r => r.ok ? await safeJson(r) : null)))
    for (const item of calls) { if (item.status === 'fulfilled' && item.value) absorb(item.value, 'similar') }
  }

  const scoreCutoff = primary === 'general' ? -20 : -50
  return dedupeAndClean(pool)
    .map(book => ({ ...book, _score: scoreBook(book, query, book._sourceTag || 'unknown') }))
    .filter(book => book._score > scoreCutoff)
    .sort((a, b) => b._score !== a._score ? b._score - a._score : Number(b.average_rating || 0) - Number(a.average_rating || 0))
    .slice(0, 60)
}

const INTENT_LABELS = {
  romcom: 'Rom-Com / Beach Read', romance: 'Romance', business: 'Business & Non-Fiction',
  thriller: 'Thriller & Suspense', fantasy: 'Fantasy', darkAcademia: 'Dark Academia',
  historical: 'Historical Fiction', selfHelp: 'Self-Help', cozy: 'Cozy Fiction',
  shortStories: 'Short Stories', scifi: 'Sci-Fi', comingOfAge: 'Coming of Age',
  sports: 'Sports', cooking: 'Cooking & Food', education: 'Science & Education',
  travel: 'Travel & Adventure', horror: 'Horror', biography: 'Biography & Memoir', poetry: 'Poetry',
}

export function DescribePage({ onOpen }) {
  const [input, setInput] = useState('')
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState('')
  const [error, setError] = useState('')
  const [charCount, setCharCount] = useState(0)
  const [detectedIntent, setDetectedIntent] = useState(null)
  const textRef = useRef(null)
  const ctrlRef = useRef(null)

  function handleInput(val) { setInput(val); setCharCount(val.length) }

  async function search(query) {
    if (!query.trim() || loading) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController(); ctrlRef.current = ctrl
    const { primary } = detectIntent(query)
    setDetectedIntent(primary !== 'general' ? primary : null)
    setLoading(true); setBooks([]); setError(''); setSearched(query.trim())
    try {
      const list = await searchByDescription(query, ctrl.signal)
      if (!list.length) setError('No books found for that description. Try rephrasing or using different keywords.')
      else setBooks(list)
    } catch (e) {
      if (e?.name !== 'AbortError') setError('Something went wrong. Please try again.')
    } finally { setLoading(false) }
  }

  function clear() {
    ctrlRef.current?.abort()
    setInput(''); setBooks([]); setSearched(''); setError(''); setCharCount(0); setLoading(false); setDetectedIntent(null)
    textRef.current?.focus()
  }

  useEffect(() => { return () => ctrlRef.current?.abort() }, [])

  return (
    <div style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent' }}>
      <div style={{ padding: '36px 32px 28px', borderBottom: '1px solid rgba(201,168,76,0.08)', background: '#202020' }}>
        <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 700, color: 'var(--gold)', letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 6px' }}>Semantic Search</p>
        <h2 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 26, fontWeight: 700, color: 'var(--cream)', margin: '0 0 8px' }}>Describe a Book</h2>
        <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--cream)', margin: 0 }}>Describe the kind of book you're in the mood for — genre, mood, setting, themes, or subject matter</p>
      </div>

      <div style={{ padding: '24px 32px 0' }}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <textarea
            ref={textRef} value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search(input) } }}
            placeholder="e.g. A romantic beach summer book… or A book about sales and marketing…"
            rows={4} maxLength={500}
            style={{ width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 12, color: 'var(--text)', fontFamily: 'Montaga,serif', fontSize: 14, lineHeight: 1.65, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.18s' }}
            onFocus={e => { e.target.style.borderColor = 'rgba(201,168,76,0.55)' }}
            onBlur={e => { e.target.style.borderColor = 'rgba(201,168,76,0.2)' }}
          />
          <div style={{ position: 'absolute', bottom: 10, right: 14, fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: charCount > 450 ? 'rgba(200,80,80,0.7)' : 'rgba(201,168,76,0.35)', pointerEvents: 'none' }}>
            {charCount}/500
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 24 }}>
          <button
            onClick={() => search(input)} disabled={loading || !input.trim()}
            style={{ padding: '11px 28px', borderRadius: 8, cursor: input.trim() && !loading ? 'pointer' : 'default', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', border: 'none', background: input.trim() && !loading ? 'var(--maroon)' : 'rgba(114,57,63,0.3)', color: 'var(--cream)', transition: 'all 0.2s' }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'rgba(255,255,255,0.7)', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                Searching…
              </span>
            ) : 'Find Books'}
          </button>
          {(input || searched) && (
            <button onClick={clear} style={{ background: 'none', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 8, padding: '10px 18px', color: 'var(--text-muted)', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, cursor: 'pointer', transition: 'border-color 0.18s' }} onMouseEnter={e => { e.target.style.borderColor = 'rgba(201,168,76,0.45)' }} onMouseLeave={e => { e.target.style.borderColor = 'rgba(201,168,76,0.2)' }}>
              Clear
            </button>
          )}
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 10 }}>Try these examples</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {EXAMPLES.map(ex => (
              <button key={ex.label} onClick={() => { handleInput(ex.prompt); search(ex.prompt) }}
                style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: 20, color: 'var(--text-muted)', fontFamily: 'Montaga,serif', fontSize: 11, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.45)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'rgba(201,168,76,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.15)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 32px 64px' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid rgba(201,168,76,0.15)', borderTopColor: 'rgba(201,168,76,0.7)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.1em' }}>Finding the perfect books for you…</p>
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: '18px 20px', background: 'rgba(114,57,63,0.15)', borderRadius: 10, border: '1px solid rgba(201,168,76,0.1)', fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            {error}
          </div>
        )}

        {!loading && searched && !error && books.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 600, color: 'var(--gold)', letterSpacing: '.15em', textTransform: 'uppercase', margin: 0 }}>{books.length} Books Found</p>
              {detectedIntent && INTENT_LABELS[detectedIntent] && (
                <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 12, padding: '2px 10px', color: 'rgba(201,168,76,0.85)' }}>
                  {INTENT_LABELS[detectedIntent]}
                </span>
              )}
              <p style={{ fontFamily: 'Montaga,serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                for: <em style={{ color: 'rgba(201,168,76,0.75)' }}>{searched.length > 80 ? searched.slice(0, 80) + '…' : searched}</em>
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 20 }}>
              {books.map((b, i) => <BookCard key={(b.title || 'book') + i} book={b} onOpen={onOpen} />)}
            </div>
          </>
        )}

        {!searched && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 0 48px' }}>
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="48" height="48" style={{ color: 'rgba(201,168,76,0.2)', marginBottom: 16 }}>
              <path d="M8 40V10a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v30" />
              <path d="M4 40h40" />
              <path d="M16 6v16l4-3 4 3V6" />
            </svg>
            <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'rgba(201,168,76,0.45)', margin: 0 }}>Describe any book vibe and we&apos;ll find your next read</p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}