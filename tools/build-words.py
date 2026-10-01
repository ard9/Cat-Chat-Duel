"""Build public/words.js: ~3000 common, family-friendly English words in 10 difficulty tiers, plus themed phrases."""
import json, math, os, re
from wordfreq import top_n_list, zipf_frequency
from english_words import get_english_words_set
import better_profanity

DICT = get_english_words_set(['gcide'], lower=True, alpha=True)
# web2 keeps capitalisation: names and places (Egypt, Andrew, Paris) exist there only capitalised
LOWER_FORMS = {w for w in get_english_words_set(['web2'], lower=False, alpha=True) if w.islower()}
PROFANITY = {l.strip().lower() for l in open(os.path.join(os.path.dirname(better_profanity.__file__), 'profanity_wordlist.txt')) if l.strip()}
# Extra words kept out of a cute family game: violence, death, adult themes, substances, insults, religion, politics.
BLOCK = set("""
kill killed killer killers killing kills murder murdered murderer gun guns gunman shoot shooting shot shots bomb bombs bombing
blood bloody bleed bleeding dead death deaths die died dies dying deadly corpse grave graves funeral suicide stab stabbed knife
knives weapon weapons war wars warfare army armed attack attacks attacked terror terrorist terrorism violent violence rape raped
abuse abused torture hostage hang hanged execution execute executed massacre victim victims wound wounded injury injured hurt
drug drugs cocaine heroin marijuana weed alcohol drunk beer beers wine vodka whiskey liquor cigarette cigarettes tobacco smoke smoking
sex sexy sexual naked nude porn erotic kiss kissing lover lovers dating bra bikini pregnant pregnancy abortion divorce
hate hated hatred racist racism nazi nazis slave slaves slavery stupid idiot dumb ugly fat loser crap hell damn sucks suck
god gods jesus christ christian christians church muslim muslims islam islamic jewish jew jews bible pray prayer religion religious
catholic allah satan devil demon demons sin sins
president election vote votes voted voting democrat democrats republican republicans liberal conservative trump obama biden
police prison jail crime crimes criminal criminals arrest arrested cop cops guilty
cancer disease virus covid pandemic sick poison toxic
senate senator congress communist democracy democratic parliament political politics republic regime racial ethnic gender
protest assault accused fraud illegal steal stolen rob threat corruption conspiracy punishment enforcement
sword combat battle arsenal military soldier soldiers nuclear fighter fighting fight enemy weapon
priest bishop heaven holy saint soul lord worship praise
butt breast toilet horror evil buried depression anxiety illness disorder disabled homeless poverty surgery therapy
casino gamble gambling bet betting
gay lesbian queer trans
bitch bastard fag
nigga nigger
""".split())
BLOCK_STEMS = ('kill', 'murd', 'rape', 'porn', 'sexu', 'nazi', 'terror', 'suicid', 'bomb', 'drunk')
# Common words that are mostly names, places, brands or abbreviations
NOT_WORDS = set("""
john james david michael paul peter mark george william robert richard thomas charles joseph mary jack mike chris tom joe
london paris york texas florida california india china japan russia america american europe european africa canada
google facebook apple amazon twitter youtube microsoft iphone android ebay
mr mrs dr st vs etc ok ii iii tho gonna wanna yeah nah lol omg hmm huh uh um ya ye
non pro sub mid per anti gen con rep las mac min via sept cant nope dude
sam bob ben don dan ted lee ann eric alan tony nick luke duke smith jay rick khan ross anna henry frank jane roger robin
lewis jean maria harry martin boston german berlin morgan billy larry barry carter walter miller jimmy jordan cooper jerry
warren jersey colorado dutch hong eve pope parker
""".split())
TWO_LETTER_OK = {'go', 'up', 'no', 'on', 'in', 'it', 'is', 'at', 'we', 'me', 'my', 'be', 'by', 'do', 'so', 'if', 'or', 'us', 'an', 'as', 'he', 'hi', 'to', 'of', 'am'}

def ok(w):
    if not re.fullmatch(r'[a-z]{2,12}', w): return False
    if len(w) == 2 and w not in TWO_LETTER_OK: return False
    if len(w) > 2 and (w not in DICT or w not in LOWER_FORMS): return False
    if w in PROFANITY or w in BLOCK or w in NOT_WORDS: return False
    if any(w.startswith(s) for s in BLOCK_STEMS): return False
    if len(w) >= 3 and len(set(w)) == 1: return False
    return True

HARD = {'q': 1.2, 'z': 1.1, 'x': 1.0, 'j': 1.0, 'k': .35, 'v': .35, 'w': .3, 'y': .3}
def difficulty(w):
    """Longer, rarer words with awkward letters and double letters are harder to type fast."""
    z = zipf_frequency(w, 'en')
    s = len(w) * 1.0
    s += max(0.0, 5.6 - z) * 1.3                       # rarer = harder to read and spell at speed
    s += sum(HARD.get(c, 0) for c in w)
    s += 0.6 * sum(1 for a, b in zip(w, w[1:]) if a == b)
    s += 0.25 * sum(1 for a, b in zip(w, w[1:]) if a in 'aeiou' and b in 'aeiou')
    return round(s, 3)

TARGET = 3000
words, seen = [], set()
for w in top_n_list('en', 60000):
    if w in seen or not ok(w): continue
    seen.add(w); words.append(w)
    if len(words) >= TARGET: break
words.sort(key=difficulty)
tiers = [[] for _ in range(10)]
for k, w in enumerate(words): tiers[min(9, k * 10 // len(words))].append(w.upper())

# Hand-written phrases, family friendly and on theme. Graded by length for levels 7 to 10.
PHRASES = """
SAVE THE CAT | CUT THE BRANCH | WATCH OUT | MOVE QUICKLY | SAVE THE ANIMAL | GOOD KITTY | RUN FAST | HOLD ON | STAY SAFE
TREE HOUSE | GREEN PARK | BLUE SKY | SUNNY DAY | BIG TREE | NICE WORK | WELL DONE | GOOD JOB | HELP IS HERE
THE CAT IS SAFE | CLIMB DOWN NOW | THE WIND IS STRONG | LOOK UP HIGH | BRING THE AXE | THE BRANCH IS BREAKING
MIND THE GAP | QUICK AS A FOX | SOFT GREEN GRASS | FLOWERS IN THE PARK | BIRDS IN THE TREE | A HAPPY CAT
THE PARK IS OPEN | KEEP YOUR EYES OPEN | TYPE IT FAST | NEVER GIVE UP | ONE MORE WORD | ALMOST THERE
THE CAT JUMPS HIGH | A BRAVE PARK WORKER | THE OLD OAK TREE | SAVE EVERY KITTEN | THE SUN IS SHINING
CLOUDS ARE MOVING | A LEAF IS FALLING | LISTEN TO THE WIND | THE KITTEN IS PURRING | WORK AS A TEAM
FAST FINGERS WIN | EYES ON THE WORDS | A TALL MAPLE TREE | THE BENCH IS WET | FEED THE BIRDS
THE BRANCH IS CRACKING | QUICKLY CUT THE BRANCH | THE CAT LANDS ON ITS FEET | A SQUIRREL RUNS AWAY
THE WORKER RUNS TO THE TREE | EVERY SECOND COUNTS | JUMP INTO THE BASKET | THE LEAVES ARE DANCING
KEEP CALM AND TYPE | THE FASTEST FINGERS | THE STRONG WIND BLOWS | A QUIET SUMMER MORNING
THE PICNIC BLANKET | FRESH AIR AND SUNSHINE | THE FOUNTAIN SPARKLES | THE SWINGS ARE MOVING
""".replace('\n', '|').split('|')
PHRASES = sorted({p.strip() for p in PHRASES if p.strip()}, key=len)
short  = [p for p in PHRASES if len(p) <= 12]
medium = [p for p in PHRASES if 12 < len(p) <= 18]
long_  = [p for p in PHRASES if len(p) > 18]

data = {
  'version': 1,
  'source': 'wordfreq common-English frequency list, filtered to dictionary words and family-friendly vocabulary',
  'tiers': tiers,
  'phrases': {'short': short, 'medium': medium, 'long': long_}
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'words.js')
with open(out, 'w') as f:
    f.write('/* Save the Cat word list. Generated by tools/build-words.py: do not edit by hand.\n'
            '   Add your own words in custom-words.txt instead. */\n')
    f.write('window.STC_WORDS = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('words:', len(words), '| file size: %.0f KB' % (os.path.getsize(out) / 1024))
for i, t in enumerate(tiers):
    lens = [len(w) for w in t]
    print(f'tier {i+1:2}: {len(t)} words, length {min(lens)}-{max(lens)} (avg {sum(lens)/len(lens):.1f})  e.g. {", ".join(t[::max(1,len(t)//7)][:7])}')
print('phrases:', len(short), 'short,', len(medium), 'medium,', len(long_), 'long')
