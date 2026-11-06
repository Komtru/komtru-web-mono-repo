// THE LOCATION SEED LIST: the one file the owner reviews before T-046 merges (design 12, Q16).
//
// Nigeria's 36 states and the FCT, each with its capital and the major commercial cities. Nothing
// here is final: TrustOps adds a city from operations-app as hubs onboard, and nothing needs a
// deploy. Edit this list freely before merge. After merge, an edit here only ADDS: the seed is
// insert-only, keyed on `${state code}:${normalised name}`, so a city staff have renamed or
// deactivated is never put back, and a name removed from this file is never deleted from the
// database.
//
//  - `capital` is always listed first, and is always a city.
//  - `cities` are the other commercial and population centres worth a dropdown row at launch.
//  - `aliases` are other things people type for a city. They are matched by prefix in the
//    typeahead and never shown. Hyphens, case and accents do not need listing: matching ignores them.
//
// A state's cities must stay under 100 so one dropdown request holds them all (platform page cap).

export interface SeedCity {
  name: string;
  aliases?: readonly string[];
}

export interface SeedState {
  /** ISO 3166-2:NG suffix. */
  code: string;
  name: string;
  capital: SeedCity;
  cities: readonly SeedCity[];
}

export const NIGERIA_LOCATIONS: readonly SeedState[] = [
  {
    code: 'AB',
    name: 'Abia',
    capital: { name: 'Umuahia' },
    cities: [{ name: 'Aba' }, { name: 'Ohafia' }],
  },
  {
    code: 'AD',
    name: 'Adamawa',
    capital: { name: 'Yola' },
    cities: [{ name: 'Mubi' }, { name: 'Numan' }],
  },
  {
    code: 'AK',
    name: 'Akwa Ibom',
    capital: { name: 'Uyo' },
    cities: [{ name: 'Eket' }, { name: 'Ikot Ekpene' }, { name: 'Oron' }],
  },
  {
    code: 'AN',
    name: 'Anambra',
    capital: { name: 'Awka' },
    cities: [{ name: 'Onitsha' }, { name: 'Nnewi' }, { name: 'Ekwulobia' }],
  },
  {
    code: 'BA',
    name: 'Bauchi',
    capital: { name: 'Bauchi' },
    cities: [{ name: 'Azare' }, { name: 'Misau' }],
  },
  {
    code: 'BY',
    name: 'Bayelsa',
    capital: { name: 'Yenagoa' },
    cities: [{ name: 'Sagbama' }, { name: 'Brass' }],
  },
  {
    code: 'BE',
    name: 'Benue',
    capital: { name: 'Makurdi' },
    cities: [{ name: 'Gboko' }, { name: 'Otukpo' }, { name: 'Katsina-Ala' }],
  },
  {
    code: 'BO',
    name: 'Borno',
    capital: { name: 'Maiduguri' },
    cities: [{ name: 'Biu' }, { name: 'Bama' }],
  },
  {
    code: 'CR',
    name: 'Cross River',
    capital: { name: 'Calabar' },
    cities: [{ name: 'Ogoja' }, { name: 'Ikom' }],
  },
  {
    code: 'DE',
    name: 'Delta',
    capital: { name: 'Asaba' },
    cities: [{ name: 'Warri' }, { name: 'Sapele' }, { name: 'Ughelli' }, { name: 'Agbor' }],
  },
  {
    code: 'EB',
    name: 'Ebonyi',
    capital: { name: 'Abakaliki' },
    cities: [{ name: 'Afikpo' }, { name: 'Onueke' }],
  },
  {
    code: 'ED',
    name: 'Edo',
    capital: { name: 'Benin City', aliases: ['Benin'] },
    cities: [{ name: 'Auchi' }, { name: 'Ekpoma' }, { name: 'Uromi' }],
  },
  {
    code: 'EK',
    name: 'Ekiti',
    capital: { name: 'Ado-Ekiti', aliases: ['Ado'] },
    cities: [{ name: 'Ikere-Ekiti' }, { name: 'Ijero-Ekiti' }],
  },
  {
    code: 'EN',
    name: 'Enugu',
    capital: { name: 'Enugu' },
    cities: [{ name: 'Nsukka' }, { name: 'Agbani' }],
  },
  {
    code: 'FC',
    name: 'Federal Capital Territory',
    capital: { name: 'Abuja', aliases: ['FCT'] },
    cities: [{ name: 'Gwagwalada' }, { name: 'Kubwa' }, { name: 'Kuje' }],
  },
  {
    code: 'GO',
    name: 'Gombe',
    capital: { name: 'Gombe' },
    cities: [{ name: 'Kumo' }, { name: 'Billiri' }],
  },
  {
    code: 'IM',
    name: 'Imo',
    capital: { name: 'Owerri' },
    cities: [{ name: 'Orlu' }, { name: 'Okigwe' }],
  },
  {
    code: 'JI',
    name: 'Jigawa',
    capital: { name: 'Dutse' },
    cities: [{ name: 'Hadejia' }, { name: 'Gumel' }],
  },
  {
    code: 'KD',
    name: 'Kaduna',
    capital: { name: 'Kaduna' },
    cities: [{ name: 'Zaria' }, { name: 'Kafanchan' }],
  },
  {
    code: 'KN',
    name: 'Kano',
    capital: { name: 'Kano' },
    cities: [{ name: 'Wudil' }, { name: 'Rano' }],
  },
  {
    code: 'KT',
    name: 'Katsina',
    capital: { name: 'Katsina' },
    cities: [{ name: 'Daura' }, { name: 'Funtua' }],
  },
  {
    code: 'KE',
    name: 'Kebbi',
    capital: { name: 'Birnin Kebbi' },
    cities: [{ name: 'Argungu' }, { name: 'Zuru' }],
  },
  {
    code: 'KO',
    name: 'Kogi',
    capital: { name: 'Lokoja' },
    cities: [{ name: 'Okene' }, { name: 'Kabba' }],
  },
  {
    code: 'KW',
    name: 'Kwara',
    capital: { name: 'Ilorin' },
    cities: [{ name: 'Offa' }, { name: 'Omu-Aran' }],
  },
  {
    code: 'LA',
    name: 'Lagos',
    capital: { name: 'Ikeja' },
    cities: [
      { name: 'Lagos Island', aliases: ['Lagos'] },
      { name: 'Victoria Island', aliases: ['VI'] },
      { name: 'Lekki' },
      { name: 'Ajah' },
      { name: 'Surulere' },
      { name: 'Yaba' },
      { name: 'Apapa' },
      { name: 'Ikorodu' },
      { name: 'Badagry' },
      { name: 'Epe' },
    ],
  },
  {
    code: 'NA',
    name: 'Nasarawa',
    capital: { name: 'Lafia' },
    cities: [{ name: 'Keffi' }, { name: 'Karu' }],
  },
  {
    code: 'NI',
    name: 'Niger',
    capital: { name: 'Minna' },
    cities: [{ name: 'Suleja' }, { name: 'Bida' }],
  },
  {
    code: 'OG',
    name: 'Ogun',
    capital: { name: 'Abeokuta' },
    cities: [{ name: 'Ijebu-Ode' }, { name: 'Sagamu' }, { name: 'Ota' }],
  },
  {
    code: 'ON',
    name: 'Ondo',
    capital: { name: 'Akure' },
    cities: [{ name: 'Ondo' }, { name: 'Owo' }],
  },
  {
    code: 'OS',
    name: 'Osun',
    capital: { name: 'Osogbo' },
    cities: [{ name: 'Ile-Ife', aliases: ['Ife'] }, { name: 'Ilesa' }, { name: 'Ede' }],
  },
  {
    code: 'OY',
    name: 'Oyo',
    capital: { name: 'Ibadan' },
    cities: [{ name: 'Ogbomosho', aliases: ['Ogbomoso'] }, { name: 'Oyo' }, { name: 'Saki' }],
  },
  {
    code: 'PL',
    name: 'Plateau',
    capital: { name: 'Jos' },
    cities: [{ name: 'Bukuru' }, { name: 'Pankshin' }],
  },
  {
    code: 'RI',
    name: 'Rivers',
    capital: { name: 'Port Harcourt', aliases: ['PH', 'Portharcourt'] },
    cities: [{ name: 'Bonny' }, { name: 'Omoku' }],
  },
  {
    code: 'SO',
    name: 'Sokoto',
    capital: { name: 'Sokoto' },
    cities: [{ name: 'Tambuwal' }, { name: 'Wurno' }],
  },
  {
    code: 'TA',
    name: 'Taraba',
    capital: { name: 'Jalingo' },
    cities: [{ name: 'Wukari' }, { name: 'Bali' }],
  },
  {
    code: 'YO',
    name: 'Yobe',
    capital: { name: 'Damaturu' },
    cities: [{ name: 'Potiskum' }, { name: 'Gashua' }],
  },
  {
    code: 'ZA',
    name: 'Zamfara',
    capital: { name: 'Gusau' },
    cities: [{ name: 'Kaura Namoda' }, { name: 'Talata Mafara' }],
  },
];
