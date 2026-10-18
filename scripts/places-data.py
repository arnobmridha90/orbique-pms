"""Build app/pages/places-data.js from public datasets plus the hand-picked tourist areas.
Usage: python3 -I scripts/places-data.py <download dir> app/pages/places-data.js
The download dir holds (raw.githubusercontent.com):
  my.json    AsyrafHussin/malaysia-postcodes/main/all.json
  th_p.json  kongvut/thai-province-data/master/api/latest/province.json
  th_d.json  kongvut/thai-province-data/master/api/latest/district.json
  id1.json   ibnux/data-indonesia/master/provinsi.json, and id_k<id>.json = kabupaten/<id>.json for each province
  ph.json    flores-jacob/philippine-regions-provinces-cities-municipalities-baranggays/master/philippine_provinces_cities_municipalities_and_barangays_2019v2.json
  vn2.json   daohoangson/dvhcvn/master/data/dvhcvn.json"""
import json, re, sys, unicodedata

G, OUT = sys.argv[1], sys.argv[2]
def load(n): return json.load(open(G + '/' + n, encoding='utf-8'))
def add(d, st, items):
    s = d.setdefault(st, [])
    seen = {x.lower() for x in s}
    for x in items:
        x = re.sub(r'\s+', ' ', x).strip()
        if x and x.lower() not in seen: s.append(x); seen.add(x.lower())
SMALL = {'del', 'de', 'ng', 'la', 'of', 'and', 'dan'}
def title(s):
    out = []
    for i, w in enumerate(s.lower().split(' ')):
        w = '-'.join(p[:1].upper() + p[1:] for p in w.split('-'))
        if i and w.lower() in SMALL: w = w.lower()
        out.append(w)
    return ' '.join(out).replace("'S ", "'s ")
def plain(s):
    s = s.replace('Đ', 'D').replace('đ', 'd')
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

# hand-picked areas guests and hosts actually use (kept from the first version, plus KL neighbourhoods)
EXTRA = {
  'MY': {
    'Johor': ['Johor Bahru', 'Iskandar Puteri', 'Pasir Gudang', 'Kulai', 'Desaru', 'Kota Tinggi', 'Batu Pahat', 'Muar', 'Kluang', 'Segamat', 'Mersing', 'Pontian'],
    'Kedah': ['Langkawi', 'Alor Setar', 'Sungai Petani', 'Kulim', 'Jitra'],
    'Kelantan': ['Kota Bharu', 'Pasir Mas', 'Tumpat', 'Tanah Merah', 'Gua Musang'],
    'Kuala Lumpur': ['Kuala Lumpur', 'KLCC', 'Bukit Bintang', 'Mont Kiara', 'Bangsar', 'Bangsar South', 'Brickfields', 'Chow Kit', 'Kampung Baru', 'Titiwangsa', 'Sentul', 'Setapak', 'Wangsa Maju', 'Setiawangsa', 'Cheras', 'Pudu', 'Sri Petaling', 'Bukit Jalil', 'Kepong', 'Segambut', 'Desa ParkCity', 'Taman Tun Dr Ismail', 'Damansara Heights', 'Sri Hartamas', 'Jalan Klang Lama', 'Mid Valley', 'Ampang Hilir', 'Jalan Ampang'],
    'Labuan': ['Labuan'],
    'Melaka': ['Melaka', 'Ayer Keroh', 'Klebang', 'Alor Gajah', 'Jasin'],
    'Negeri Sembilan': ['Seremban', 'Port Dickson', 'Nilai', 'Kuala Pilah', 'Bahau'],
    'Pahang': ['Kuantan', 'Genting Highlands', 'Cameron Highlands', 'Bentong', "Fraser's Hill", 'Cherating', 'Tioman Island', 'Temerloh', 'Raub'],
    'Penang': ['George Town', 'Batu Ferringhi', 'Tanjung Bungah', 'Tanjung Tokong', 'Gelugor', 'Air Itam', 'Bayan Lepas', 'Balik Pulau', 'Butterworth', 'Bukit Mertajam'],
    'Perak': ['Ipoh', 'Taiping', 'Lumut', 'Pangkor Island', 'Sitiawan', 'Kampar', 'Teluk Intan'],
    'Perlis': ['Kangar', 'Arau', 'Padang Besar'],
    'Putrajaya': ['Putrajaya'],
    'Sabah': ['Kota Kinabalu', 'Kundasang', 'Ranau', 'Sandakan', 'Semporna', 'Tawau', 'Lahad Datu', 'Kudat'],
    'Sarawak': ['Kuching', 'Miri', 'Sibu', 'Bintulu', 'Mukah'],
    'Selangor': ['Petaling Jaya', 'Shah Alam', 'Subang Jaya', 'Cyberjaya', 'Puchong', 'Seri Kembangan', 'Sepang', 'Klang', 'Port Klang', 'Ampang', 'Kajang', 'Bangi', 'Rawang'],
    'Terengganu': ['Kuala Terengganu', 'Redang Island', 'Perhentian Islands', 'Kemaman', 'Dungun', 'Besut'],
  },
  'SG': {
    'Central': ['Orchard', 'Marina Bay', 'Downtown Core', 'River Valley', 'Tanjong Pagar', 'Chinatown', 'Bugis', 'Novena', 'Newton', 'Bukit Timah', 'Tiong Bahru', 'Queenstown', 'Kallang', 'Toa Payoh', 'Bishan', 'Sentosa',
                'Bukit Merah', 'Marina South', 'Museum', 'Outram', 'Rochor', 'Singapore River', 'Southern Islands', 'Tanglin', 'Holland Village', 'Robertson Quay', 'Clarke Quay', 'Little India', 'Farrer Park', 'Balestier', 'Dhoby Ghaut', 'Raffles Place', 'Telok Ayer', 'Keppel'],
    'East': ['Katong', 'Marine Parade', 'Geylang', 'Bedok', 'Tampines', 'Pasir Ris', 'Changi', 'Paya Lebar', 'Joo Chiat', 'Siglap', 'East Coast', 'Simei', 'Loyang', 'Tanah Merah'],
    'North': ['Woodlands', 'Yishun', 'Sembawang', 'Mandai', 'Lim Chu Kang', 'Sungei Kadut', 'Admiralty', 'Khatib'],
    'North-East': ['Ang Mo Kio', 'Serangoon', 'Hougang', 'Sengkang', 'Punggol', 'Seletar', 'Kovan', 'Buangkok', 'Pulau Ubin'],
    'West': ['Jurong East', 'Jurong West', 'Clementi', 'Bukit Batok', 'Bukit Panjang', 'Choa Chu Kang', 'Boon Lay', 'Pioneer', 'Tengah', 'Tuas', 'West Coast', 'Dover', 'Pasir Panjang', 'Jurong Island'],
  },
  'TH': {
    'Bangkok': ['Sukhumvit', 'Silom', 'Sathorn', 'Siam', 'Riverside', 'Ratchathewi', 'Chatuchak', 'Khao San', 'Thonglor', 'Ekkamai', 'Asok', 'Nana', 'Phrom Phong', 'Ari', 'Ratchada'],
    'Chiang Mai': ['Chiang Mai', 'Nimman', 'Old City', 'Mae Rim', 'Doi Saket'],
    'Chiang Rai': ['Chiang Rai'],
    'Chon Buri': ['Pattaya', 'Jomtien', 'Na Jomtien', 'Si Racha', 'Bang Saen', 'Koh Larn'],
    'Krabi': ['Ao Nang', 'Krabi Town', 'Railay', 'Koh Lanta', 'Koh Phi Phi', 'Klong Muang', 'Tubkaek'],
    'Mae Hong Son': ['Pai', 'Mae Hong Son'],
    'Phang Nga': ['Khao Lak', 'Koh Yao', 'Natai'],
    'Phuket': ['Patong', 'Kata', 'Karon', 'Kamala', 'Bang Tao', 'Rawai', 'Phuket Town', 'Surin', 'Nai Harn', 'Chalong', 'Mai Khao', 'Nai Yang', 'Laguna', 'Cherng Talay'],
    'Prachuap Khiri Khan': ['Hua Hin', 'Pranburi', 'Khao Takiab'],
    'Surat Thani': ['Koh Samui', 'Koh Phangan', 'Koh Tao', 'Surat Thani', 'Chaweng', 'Lamai', 'Bophut', 'Maenam', 'Haad Rin', 'Khao Sok'],
    'Rayong': ['Koh Samet', 'Ban Phe', 'Mae Ramphueng'],
    'Trat': ['Koh Chang', 'Koh Kood', 'Koh Mak'],
    'Satun': ['Koh Lipe'],
  },
  'ID': {
    'Bali': ['Seminyak', 'Canggu', 'Ubud', 'Kuta', 'Legian', 'Sanur', 'Nusa Dua', 'Uluwatu', 'Jimbaran', 'Denpasar', 'Nusa Penida', 'Pererenan', 'Berawa', 'Kerobokan', 'Umalas', 'Pecatu', 'Bingin', 'Amed', 'Lovina', 'Sidemen', 'Munduk', 'Tabanan', 'Nusa Lembongan', 'Candidasa'],
    'East Java': ['Surabaya', 'Malang', 'Batu', 'Banyuwangi', 'Bromo'],
    'Jakarta': ['Central Jakarta', 'South Jakarta', 'North Jakarta', 'West Jakarta', 'East Jakarta', 'Thousand Islands', 'Kemang', 'Menteng', 'SCBD', 'Kuningan', 'PIK'],
    'North Sumatra': ['Medan', 'Lake Toba', 'Samosir', 'Berastagi'],
    'Riau Islands': ['Batam', 'Bintan', 'Nongsa', 'Lagoi'],
    'West Java': ['Bandung', 'Bogor', 'Depok', 'Bekasi', 'Lembang', 'Puncak', 'Sentul'],
    'West Nusa Tenggara': ['Lombok', 'Gili Islands', 'Gili Trawangan', 'Gili Air', 'Gili Meno', 'Mataram', 'Senggigi', 'Kuta Lombok', 'Selong Belanak'],
    'East Nusa Tenggara': ['Labuan Bajo', 'Komodo'],
    'Yogyakarta': ['Yogyakarta', 'Sleman'],
    'Banten': ['Tangerang', 'BSD City', 'Anyer'],
  },
  'PH': {
    'Aklan': ['Boracay'],
    'Benguet': ['Baguio'],
    'Bohol': ['Panglao', 'Tagbilaran'],
    'Cebu': ['Cebu City', 'Mactan', 'Moalboal'],
    'Metro Manila': ['Makati', 'Taguig (BGC)', 'Pasay', 'Manila', 'Quezon City', 'Mandaluyong', 'Pasig', 'Ortigas', 'Bonifacio Global City'],
    'Palawan': ['El Nido', 'Coron', 'Puerto Princesa', 'Port Barton'],
    'Surigao del Norte': ['Siargao', 'General Luna'],
    'Batangas': ['Nasugbu', 'Anilao'],
    'Cavite': ['Tagaytay'],
    'La Union': ['San Juan'],
    'Oriental Mindoro': ['Puerto Galera'],
  },
  'VN': {
    'Da Nang': ['Da Nang', 'Hoi An', 'My Khe', 'Son Tra'],
    'Hanoi': ['Hoan Kiem', 'Ba Dinh', 'Tay Ho', 'Cau Giay', 'Old Quarter'],
    'Ho Chi Minh City': ['District 1', 'District 3', 'Binh Thanh', 'District 7', 'Thu Duc', 'Thao Dien', 'Vung Tau'],
    'Khanh Hoa': ['Nha Trang', 'Cam Ranh'],
    'An Giang': ['Phu Quoc', 'Rach Gia', 'Ha Tien'],
    'Lam Dong': ['Da Lat', 'Mui Ne', 'Phan Thiet'],
    'Quang Ninh': ['Ha Long', 'Bai Chay'],
    'Lao Cai': ['Sa Pa'],
    'Ninh Binh': ['Trang An', 'Tam Coc'],
    'Hue': ['Hue'],
  },
}
P = {c: {} for c in EXTRA}
for c, sts in EXTRA.items():
    for st, xs in sts.items(): add(P[c], st, xs)

# Malaysia: every post-office town per state
MYN = {'Wp Kuala Lumpur': 'Kuala Lumpur', 'Wp Labuan': 'Labuan', 'Wp Putrajaya': 'Putrajaya', 'Pulau Pinang': 'Penang'}
for s in load('my.json')['state']:
    st = MYN.get(s['name'], s['name'])
    add(P['MY'], st, [re.sub(r'\s+\d+$', '', x['name']) for x in s['city']])

# Thailand: every district (amphoe, and khet in Bangkok)
TH = {x['id']: x['name']['en'].replace('Phangnga', 'Phang Nga') for x in load('th_p.json')}
for x in load('th_d.json'):
    if x.get('deleted_at'): continue
    add(P['TH'], TH[x['province_id']], [x['name']['en']])

# Indonesia: every regency and city
IDN = {'Aceh': 'Aceh', 'Sumatera Utara': 'North Sumatra', 'Sumatera Barat': 'West Sumatra', 'Riau': 'Riau', 'Jambi': 'Jambi', 'Sumatera Selatan': 'South Sumatra', 'Bengkulu': 'Bengkulu',
       'Lampung': 'Lampung', 'Kepulauan Bangka Belitung': 'Bangka Belitung Islands', 'Kepulauan Riau': 'Riau Islands', 'Daerah Khusus Ibukota Jakarta': 'Jakarta', 'Jawa Barat': 'West Java',
       'Jawa Tengah': 'Central Java', 'Daerah Istimewa Yogyakarta': 'Yogyakarta', 'Jawa Timur': 'East Java', 'Banten': 'Banten', 'Bali': 'Bali', 'Nusa Tenggara Barat': 'West Nusa Tenggara',
       'Nusa Tenggara Timur': 'East Nusa Tenggara', 'Kalimantan Barat': 'West Kalimantan', 'Kalimantan Tengah': 'Central Kalimantan', 'Kalimantan Selatan': 'South Kalimantan',
       'Kalimantan Timur': 'East Kalimantan', 'Kalimantan Utara': 'North Kalimantan', 'Sulawesi Utara': 'North Sulawesi', 'Sulawesi Tengah': 'Central Sulawesi', 'Sulawesi Selatan': 'South Sulawesi',
       'Sulawesi Tenggara': 'Southeast Sulawesi', 'Gorontalo': 'Gorontalo', 'Sulawesi Barat': 'West Sulawesi', 'Maluku': 'Maluku', 'Maluku Utara': 'North Maluku', 'Papua': 'Papua',
       'Papua Barat': 'West Papua', 'Papua Selatan': 'South Papua', 'Papua Tengah': 'Central Papua', 'Papua Pegunungan': 'Highland Papua', 'Papua Barat Daya': 'Southwest Papua'}
JKT = {'Jakarta Pusat': 'Central Jakarta', 'Jakarta Selatan': 'South Jakarta', 'Jakarta Utara': 'North Jakarta', 'Jakarta Barat': 'West Jakarta', 'Jakarta Timur': 'East Jakarta', 'Kepulauan Seribu': 'Thousand Islands', 'Kepulauan': 'Thousand Islands'}
for pv in load('id1.json'):
    st = IDN[pv['nama']]
    out = []
    for k in load('id_k%s.json' % pv['id']):
        n = title(k['nama'].strip())
        m = re.match(r'(Kabupaten|Kota)( Administrasi)? (.+)$', n)
        if not m: out.append(n); continue
        base = m.group(3)
        if base in JKT: out.append(JKT[base])
        elif m.group(1) == 'Kota': out.append(base)
        else: out.append(base + ' Regency')
    add(P['ID'], st, out)

# Philippines: every city and municipality
PHN = {'SAMAR (WESTERN SAMAR)': 'Samar', 'DAVAO (DAVAO DEL NORTE)': 'Davao del Norte', 'COTABATO (NORTH COT.)': 'Cotabato', 'COMPOSTELA VALLEY': 'Davao de Oro'}
def phname(m):
    m = re.sub(r'\s*\(.*?\)', '', m).strip()
    m = re.sub(r'^CITY OF (.+)$', r'\1', m)
    return title(m).replace('Lapu-Lapu', 'Lapu-Lapu')
for reg in load('ph.json').values():
    for pv, v in reg['province_list'].items():
        st = 'Metro Manila' if pv.startswith('NATIONAL CAPITAL REGION') or pv == 'TAGUIG - PATEROS' else PHN.get(pv, title(pv))
        ms = [phname(m) for m in v['municipality_list']]
        if pv == 'NATIONAL CAPITAL REGION - MANILA': ms = ['Manila'] + ['Manila (' + x + ')' for x in ms]
        add(P['PH'], st, ms)

# Vietnam: the 34 provinces from July 2025, with the former districts and towns of the provinces merged into each
VNM = {'Ha Noi': 'Hanoi', 'Hue': 'Hue', 'Lai Chau': 'Lai Chau', 'Dien Bien': 'Dien Bien', 'Son La': 'Son La', 'Lang Son': 'Lang Son', 'Quang Ninh': 'Quang Ninh', 'Thanh Hoa': 'Thanh Hoa',
       'Nghe An': 'Nghe An', 'Ha Tinh': 'Ha Tinh', 'Cao Bang': 'Cao Bang',
       'Tuyen Quang': 'Tuyen Quang', 'Ha Giang': 'Tuyen Quang', 'Lao Cai': 'Lao Cai', 'Yen Bai': 'Lao Cai', 'Thai Nguyen': 'Thai Nguyen', 'Bac Kan': 'Thai Nguyen',
       'Phu Tho': 'Phu Tho', 'Vinh Phuc': 'Phu Tho', 'Hoa Binh': 'Phu Tho', 'Bac Ninh': 'Bac Ninh', 'Bac Giang': 'Bac Ninh', 'Hung Yen': 'Hung Yen', 'Thai Binh': 'Hung Yen',
       'Hai Phong': 'Hai Phong', 'Hai Duong': 'Hai Phong', 'Ninh Binh': 'Ninh Binh', 'Ha Nam': 'Ninh Binh', 'Nam Dinh': 'Ninh Binh', 'Quang Tri': 'Quang Tri', 'Quang Binh': 'Quang Tri',
       'Da Nang': 'Da Nang', 'Quang Nam': 'Da Nang', 'Quang Ngai': 'Quang Ngai', 'Kon Tum': 'Quang Ngai', 'Gia Lai': 'Gia Lai', 'Binh Dinh': 'Gia Lai',
       'Khanh Hoa': 'Khanh Hoa', 'Ninh Thuan': 'Khanh Hoa', 'Lam Dong': 'Lam Dong', 'Dak Nong': 'Lam Dong', 'Binh Thuan': 'Lam Dong', 'Dak Lak': 'Dak Lak', 'Phu Yen': 'Dak Lak',
       'Ho Chi Minh': 'Ho Chi Minh City', 'Binh Duong': 'Ho Chi Minh City', 'Ba Ria - Vung Tau': 'Ho Chi Minh City', 'Dong Nai': 'Dong Nai', 'Binh Phuoc': 'Dong Nai',
       'Tay Ninh': 'Tay Ninh', 'Long An': 'Tay Ninh', 'Can Tho': 'Can Tho', 'Soc Trang': 'Can Tho', 'Hau Giang': 'Can Tho', 'Vinh Long': 'Vinh Long', 'Ben Tre': 'Vinh Long',
       'Tra Vinh': 'Vinh Long', 'Dong Thap': 'Dong Thap', 'Tien Giang': 'Dong Thap', 'Ca Mau': 'Ca Mau', 'Bac Lieu': 'Ca Mau', 'An Giang': 'An Giang', 'Kien Giang': 'An Giang'}
for pv in load('vn2.json')['data']:
    old = plain(re.sub(r'^(Thành phố|Tỉnh) ', '', pv['name'])).replace('Hoa Binh', 'Hoa Binh')
    st = VNM[old]
    out = []
    for x in pv['level2s']:
        n = plain(re.sub(r'^(Quận|Huyện|Thị xã|Thành phố) ', '', x['name']))
        if re.fullmatch(r'\d+', n): n = 'District ' + n
        out.append(n)
    add(P['VN'], st, out)
assert len(P['VN']) == 34, sorted(P['VN'])

for st, xs in P['PH'].items():  # "Pasay City" next to "Pasay": keep the short name
    low = {x.lower() for x in xs}
    P['PH'][st] = [x for x in xs if not (x.endswith(' City') and x[:-5].lower() in low)]
for c in P:
    for st in P[c]: P[c][st].sort(key=lambda x: x.lower())
js = ('/* Generated list of states (or regions) and their cities, towns and areas for O.places (app/pages/places.js).\n'
      '   Sources: Malaysian post-office towns, Singapore planning areas, Thai districts, Indonesian regencies and cities,\n'
      '   Philippine cities and municipalities, and the 34 Vietnamese provinces of July 2025 with their former districts,\n'
      '   plus hand-picked tourist areas. Rebuild with scripts/places-data.py instead of editing by hand. */\n'
      'window.O.placeData = ' + json.dumps(P, ensure_ascii=False, indent=0, sort_keys=True).replace('\n', '') + ';\n')
open(OUT, 'w', encoding='utf-8').write(js)
for c in P: print(c, len(P[c]), sum(len(v) for v in P[c].values()))
print(len(js))
