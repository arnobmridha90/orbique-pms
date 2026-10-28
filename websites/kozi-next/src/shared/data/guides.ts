// The Kozi guides: practical answers to what guests ask before they fly. Every fact links to a
// source at the end of its guide; check them again before changing a number here.
export type Guide = {
  slug: string; tag: string; title: string; h1: string; desc: string; lede: string;
  photo: { key: string; alt: string; pos?: string }; checked: string; html: string; sources: { name: string; url: string }[];
};

export const GUIDE_PAGES: Guide[] = [
  {
    slug: 'mdac-malaysia-digital-arrival-card', tag: 'Arrival',
    title: 'MDAC: the Malaysia Digital Arrival Card, step by step',
    h1: 'The MDAC <em>arrival card.</em>',
    desc: 'How to fill in the free Malaysia Digital Arrival Card (MDAC) before you land, who is exempt, and how to avoid fake MDAC websites that charge a fee.',
    lede: 'Most foreign visitors must submit the free Malaysia Digital Arrival Card online before they land. It takes a few minutes, and the only real website ends in imi.gov.my.',
    photo: { key: 'premium-b/10-klcc-window-view', alt: 'The Petronas Twin Towers by day from a Kozi suite window', pos: '50% 24%' },
    checked: 'October 2026',
    html: `<h2>What the MDAC is</h2>
<p>The Malaysia Digital Arrival Card (MDAC) is an online form from the Immigration Department of Malaysia. It replaces the paper arrival card. Most foreign visitors submit it before arriving by air, land or sea.</p>
<div class="g-note"><b>The MDAC is free.</b> The official form is at <a href="https://imigresen-online.imi.gov.my/mdac/main" rel="noopener">imigresen-online.imi.gov.my/mdac/main</a>. Any site that asks you to pay is not the Immigration Department.</div>
<h2>When to submit it</h2>
<p>Submit the MDAC within the 3 days before you arrive in Malaysia. Guides word this slightly differently, so check the exact window on the official portal when you fill it in.</p>
<h2>Step by step</h2>
<ol>
<li>Open the official portal at imigresen-online.imi.gov.my and choose the MDAC registration form.</li>
<li>Enter your details exactly as they appear in your passport.</li>
<li>Add your trip: arrival date, how you arrive (for example, your flight number) and your departure date.</li>
<li>Add your address in Malaysia. If you are staying with us, use the Kozi @ Vortex KLCC address from your booking confirmation.</li>
<li>Submit the form and keep the confirmation email or a screenshot on your phone.</li>
</ol>
<p>The form's fields can change, so follow what the portal shows on the day.</p>
<h2>Watch out for fake MDAC websites</h2>
<p>In January 2025 the Immigration Department warned travellers about a fraudulent MDAC website. Copycat sites charge a fee and sometimes appear as paid search ads above the real site. Check the address bar: the real site ends in <b>imi.gov.my</b>.</p>
<h2>Who doesn't need an MDAC</h2>
<p>Singapore citizens are exempt, as reported in 2023. Other exemptions, such as for diplomatic passport holders and Malaysian permanent residents, differ between sources. If you're not sure, check the official portal before you travel.</p>
<h2>Visas are a separate question</h2>
<p>The MDAC is not a visa. Visa-free stays depend on your nationality. For example, Indian and Chinese citizens can visit visa-free for 30 days for tourism until 31 December 2026. Check your own country on the Immigration Department's website.</p>`,
    sources: [
      { name: 'Immigration Department of Malaysia: MDAC portal', url: 'https://imigresen-online.imi.gov.my/mdac/main' },
      { name: 'Bernama: Immigration Department warns of fake MDAC website', url: 'https://www.bernama.com/en/news.php?id=2379295' },
      { name: 'Malay Mail: Singaporeans not required to fill in the digital arrival card (2023)', url: 'https://www.malaymail.com/news/malaysia/2023/12/06/report-singaporeans-travelling-to-malaysia-not-required-to-fill-in-digital-arrival-card-says-saifuddin-nasution/106060' },
      { name: 'Wego: MDAC guide', url: 'https://blog.wego.com/mdac/' },
      { name: 'EY: Malaysia extends visa exemption for India and China nationals', url: 'https://www.ey.com/en_gl/technical/tax-alerts/malaysia-extends-visa-exemption-period-for-india-and-china-nationals' },
    ],
  },
  {
    slug: 'klia-to-kuala-lumpur-city-centre', tag: 'Getting here',
    title: 'KLIA to Kuala Lumpur city centre: train, Grab or taxi',
    h1: 'KLIA to the <em>city centre.</em>',
    desc: 'How to get from KLIA Terminal 1 or 2 to central Kuala Lumpur and KLCC: KLIA Ekspres fares (including the 1 January 2027 rise), Grab and airport taxi costs, and late-night options.',
    lede: 'Three good ways in from Kuala Lumpur International Airport: the KLIA Ekspres train, a Grab car or a prepaid taxi. Here is what each costs and when to pick it.',
    photo: { key: 'boutique/05-bedroom-window-view', alt: 'The city by day from a Kozi bedroom window' },
    checked: 'October 2026',
    html: `<h2>At a glance</h2>
<div class="g-table"><table>
<thead><tr><th>Option</th><th>Cost (adult)</th><th>Time</th><th>Best for</th></tr></thead>
<tbody>
<tr><td>KLIA Ekspres to KL Sentral</td><td>RM55 one way until 31 Dec 2026; RM65 from 1 Jan 2027</td><td>About 28 minutes, then a short ride on</td><td>Light luggage, daytime, avoiding traffic</td></tr>
<tr><td>Grab (ride-hailing app)</td><td>About RM65–100 off-peak; more at busy times</td><td>Depends on traffic</td><td>Families, heavy bags, door to door</td></tr>
<tr><td>Airport coupon taxi</td><td>About RM75–120 for a standard car</td><td>Depends on traffic</td><td>No app, paying a fixed price upfront</td></tr>
</tbody></table></div>
<p>The Grab and taxi figures are estimates from 2026 travel guides, not official tariffs.</p>
<h2>KLIA Ekspres</h2>
<p>The non-stop airport train runs from KLIA Terminal 1 and Terminal 2 to KL Sentral in about 28 minutes, with trains roughly every 20 minutes. It runs until about 1am.</p>
<div class="g-note"><b>Fares change on 1 January 2027.</b> Adults pay RM55 one way until 31 December 2026. From 1 January 2027 it is RM65 one way or RM118 return. Children aged 6 to 15 pay RM29 one way or RM53 return, and under-6s ride free.</div>
<p>From KL Sentral, take a Grab or a taxi to Kozi @ Vortex KLCC, or message us for the best train connection on your arrival day.</p>
<h2>Grab</h2>
<p>Grab is South-East Asia's main ride-hailing app. Book from the arrivals hall and meet the driver at the marked pick-up point. Prices rise at busy times, so compare with the train if the app shows a surge.</p>
<h2>Airport coupon taxi</h2>
<p>Buy a prepaid coupon at the taxi counter in arrivals. Prices are fixed by zone and car size, so you know the cost before you leave.</p>
<h2>Arriving late at night</h2>
<p>After the last train, a Grab or a coupon taxi is the way in. Just tell us your flight time, and we'll make sure your check-in works for a late arrival.</p>
<h2>Touch 'n Go card</h2>
<p>For trains and buses around the city, a Touch 'n Go card costs a RM10 issue fee plus the credit you load. You can buy one at the KLIA Ekspres counters and at convenience stores.</p>`,
    sources: [
      { name: 'paultan.org: KLIA Ekspres fares go up from 1 January 2027', url: 'https://paultan.org/2026/09/30/klia-ekspres-transit-fares-to-go-up-effective-january-1-kl-sentral-klia-rm65-one-way-rm118-return/' },
      { name: 'The Star: KLIA Ekspres, Transit fares up from Jan 1', url: 'https://www.thestar.com.my/news/nation/2026/10/01/klia-ekspres-transit-fares-up-from-jan-1' },
      { name: 'Wego: KLIA to Kuala Lumpur city guide', url: 'https://blog.wego.com/klia-to-kuala-lumpur-city/' },
      { name: 'Wikipedia: KLIA Ekspres', url: 'https://en.wikipedia.org/wiki/KLIA_Ekspres' },
      { name: 'Miss Lobang: KLIA to KL city transport guide 2026', url: 'https://www.misslobang.my/article/klia-to-kl-city-transport-guide' },
      { name: "Trip.com: Touch 'n Go card and eWallet", url: 'https://my.trip.com/guide/payments/touch-n-go-card-ewallet.html' },
    ],
  },
  {
    slug: 'halal-food-near-klcc', tag: 'Food',
    title: 'Halal food near KLCC and Jalan Sultan Ismail',
    h1: 'Eating halal <em>near KLCC.</em>',
    desc: 'How to tell halal-certified food in Malaysia (the JAKIM logo, not "pork-free"), and halal and Muslim-run places to start with near KLCC and Vortex KLCC.',
    lede: 'Malaysia is one of the easiest places in the world to eat halal. The one thing to know is how to read the signs, and where to start near Vortex KLCC.',
    photo: { key: 'premium-a/01-dining-and-living', alt: 'Dining table under rattan lamps in a Kozi Premium Suite' },
    checked: 'October 2026',
    html: `<h2>Look for the JAKIM logo, not "pork-free"</h2>
<p>Halal certification in Malaysia comes from JAKIM, the Department of Islamic Development. Certified restaurants display the JAKIM halal logo. A "pork-free" or "no pork" sign is not the same thing, and JAKIM has warned that such signs can mislead Muslim diners. When it matters to you, look for the logo at the counter.</p>
<div class="g-note"><b>Quick rule:</b> JAKIM logo means certified halal. "Muslim-owned" or "Muslim-run" usually means halal food but not always certification. "Pork-free" alone is not halal.</div>
<h2>Near KLCC</h2>
<ul>
<li><b>Suria KLCC</b>, the mall under the Twin Towers. Ahh-Yum in the Signatures Food Court (Level 2) is listed as halal-certified. Serai's central kitchen is halal-certified. Melur and Thyme serves no alcohol, drinks included.</li>
<li><b>Damascus</b> on Jalan Sultan Ismail, the same road as Vortex KLCC, is a Muslim-owned restaurant.</li>
<li><b>Mamak restaurants</b> on Jalan Ampang are Indian-Muslim restaurants, open late and good for roti canai and teh tarik.</li>
</ul>
<h2>Kampung Baru for Malay food</h2>
<p>Kampung Baru, across the river from KLCC, is the city's Malay village and a hub for Malay food such as nasi lemak. Many stalls take cash only, so carry small notes.</p>
<h2>Jalan Alor</h2>
<p>Jalan Alor's night market is famous, but most of its Chinese stalls are not halal. Check each stall before you order.</p>
<h2>Ask us</h2>
<p>Email us and we'll point you to halal places that suit your plans.</p>`,
    sources: [
      { name: 'Malaysiakini: JAKIM on "no pork" signs', url: 'https://malaysiakini.com/news/330459' },
      { name: 'Have Halal Will Travel: Ahh-Yum, Suria KLCC', url: 'https://www.havehalalwilltravel.com/halal-restaurants/detail/ahh-yum-suria-klcc' },
      { name: 'Seth Lui: Suria KLCC food guide', url: 'https://sethlui.com/suria-klcc-food-guide-malaysia/' },
      { name: 'Yelp: halal near Jalan Sultan Ismail', url: 'https://www.yelp.com/search?cflt=halal&find_loc=Jalan+Sultan+Ismail%2C+50250+Kuala+Lumpur' },
      { name: 'OpenRice: Malay food in Kampung Baru', url: 'https://my.openrice.com/en/klangvalley/article/6-malay-delicacies-in-kampung-baru-kl-a333' },
      { name: 'KL Foodie: best halal and Muslim-owned spots, 2025', url: 'https://klfoodie.com/10-best-halal-muslim-owned-food-spots-in-kl-pj-2025-guide/' },
    ],
  },
];
