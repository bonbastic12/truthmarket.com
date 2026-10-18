import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type Lang } from '../i18n/I18nContext';

interface Block {
  heading: string;
  body?: string;
  points?: string[];
}

interface Copy {
  title: string;
  updated: string;
  intro: string;
  general: Block[];
  idTitle: string;
  idLead: string;
  id: Block[];
  contactTitle: string;
  contact: string;
  verifyCta: string;
  switchLabel: string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: 15 October 2026',
    intro:
      'Truth Market is a marketplace where people buy and sell social media accounts, channels, websites and web apps. This page explains what personal data we use and how we protect it.',
    general: [
      {
        heading: 'What we collect',
        points: [
          'Account details: your name, email, phone number and a password (stored only as a one-way hash).',
          'Marketplace activity: listings, orders and payment status. Card and mobile money details are handled by Chapa, not by us.',
        ],
      },
      {
        heading: 'Why we use it',
        body: 'To run the marketplace, keep escrow payments safe, prevent fraud and answer support requests.',
      },
    ],
    idTitle: 'Identity Verification & National ID Security',
    idLead:
      'Anyone who wants to sell on Truth Market must complete an identity check. This applies to sellers only. Buyers are not asked for an ID.',
    id: [
      {
        heading: 'Why it is mandatory',
        body: 'National ID and phone number matching are mandatory anti-fraud measures. Selling a stolen or fake account is the biggest risk for buyers on any marketplace. Before a seller can create a listing or report a handover, we check three things: a clear photo of the National ID, that the phone number linked to the ID is the same as the phone number on the Truth Market account, and a one-time SMS code sent to that phone. If the ID is missing, does not pass our review, or the phone numbers do not match, selling is blocked automatically and the account is put on hold for review.',
      },
      {
        heading: 'What we collect for this check',
        points: [
          'A photo of your National ID.',
          'Your full name and National ID number as printed on the ID.',
          'The phone number linked to your ID, and whether the SMS code was entered correctly.',
        ],
      },
      {
        heading: 'How the data is protected',
        points: [
          'Your ID photo and ID number are securely encrypted (AES-256) before they are stored. The ID photo is kept as an encrypted file, separate from the marketplace data.',
          'Your ID number is also turned into a one-way fingerprint, only so that the same ID cannot be used on two accounts. The number cannot be read back from the fingerprint.',
          'Data travels between your device and our servers over an encrypted connection (HTTPS).',
          'Only authorised Truth Market reviewers can open an ID photo, only while reviewing it, and every time it is opened is written to a log.',
          'SMS codes are stored only as a hash, expire after 5 minutes and are blocked after 5 wrong tries.',
        ],
      },
      {
        heading: 'Who can see it',
        body: 'Your National ID and ID photo are never shown to buyers or other users, and they are never sold or shared with third parties. Buyers only see a "Verified seller" badge. Two narrow exceptions: our SMS provider receives your phone number and the code message so that it can deliver the code, and we will disclose information to the authorities if Ethiopian law requires it.',
      },
      {
        heading: 'How long we keep it',
        body: 'If we reject a submission, the ID photo and number are deleted at once. For verified sellers they are kept while the seller account is active and for as long as the law requires to investigate fraud. You can ask us to delete your identity data after you close your account.',
      },
    ],
    contactTitle: 'Questions or requests',
    contact: 'Contact us on Telegram @wodlabs or WhatsApp +251 987 811 955.',
    verifyCta: 'Verify my identity',
    switchLabel: 'Language',
  },
  am: {
    title: 'የግላዊነት ፖሊሲ',
    updated: 'መጨረሻ የተሻሻለው፦ ጥቅምት 15 ቀን 2026',
    intro:
      'Truth Market ሰዎች የማህበራዊ ሚዲያ አካውንቶችን፣ ቻናሎችን፣ ድረ-ገጾችንና የድር መተግበሪያዎችን የሚገዙበትና የሚሸጡበት ገበያ ነው። ይህ ገጽ የምንጠቀምባቸውን የግል መረጃዎችና እንዴት እንደምንጠብቃቸው ያብራራል።',
    general: [
      {
        heading: 'የምንሰበስበው መረጃ',
        points: [
          'የአካውንት መረጃ፦ ስምዎ፣ ኢሜይልዎ፣ ስልክ ቁጥርዎና የይለፍ ቃልዎ (የይለፍ ቃሉ የሚቀመጠው በአንድ አቅጣጫ በተመሰጠረ መልክ ብቻ ነው)።',
          'የገበያ እንቅስቃሴ፦ ዝርዝሮች፣ ትዕዛዞችና የክፍያ ሁኔታ። የካርድና የሞባይል ገንዘብ መረጃ የሚያዘው በChapa ነው፣ በእኛ አይደለም።',
        ],
      },
      {
        heading: 'ለምን እንጠቀምበታለን',
        body: 'ገበያውን ለማስኬድ፣ የescrow ክፍያዎችን ለመጠበቅ፣ ማጭበርበርን ለመከላከልና የድጋፍ ጥያቄዎችን ለመመለስ ነው።',
      },
    ],
    idTitle: 'የማንነት ማረጋገጫና የብሔራዊ መታወቂያ ደህንነት',
    idLead:
      'በTruth Market ላይ መሸጥ የሚፈልግ ማንኛውም ሰው የማንነት ማረጋገጫ ማጠናቀቅ አለበት። ይህ ለሻጮች ብቻ ነው የሚመለከተው፤ ገዢዎች መታወቂያ አይጠየቁም።',
    id: [
      {
        heading: 'ለምን አስገዳጅ ነው',
        body: 'የብሔራዊ መታወቂያና የስልክ ቁጥር ማመሳከሪያ አስገዳጅ የፀረ-ማጭበርበር እርምጃዎች ናቸው። የተሰረቀ ወይም የሐሰት አካውንት መሸጥ በማንኛውም ገበያ ላይ ለገዢዎች ትልቁ አደጋ ነው። ሻጭ ዝርዝር ከመፍጠሩ ወይም ርክክብ ከማሳወቁ በፊት ሦስት ነገሮችን እናረጋግጣለን፦ የብሔራዊ መታወቂያው ግልጽ ፎቶ፣ ከመታወቂያው ጋር የተገናኘው ስልክ ቁጥር በTruth Market አካውንት ላይ ካለው ስልክ ቁጥር ጋር አንድ መሆኑን፣ እና ወደዚያ ስልክ የሚላክ የአንድ ጊዜ SMS ኮድ። መታወቂያው ከሌለ፣ በግምገማችን ካላለፈ፣ ወይም ስልክ ቁጥሮቹ ካልተመሳሰሉ መሸጥ በራስ-ሰር ይታገዳል፣ አካውንቱም ለግምገማ ይያዛል።',
      },
      {
        heading: 'ለዚህ ማረጋገጫ የምንሰበስበው',
        points: [
          'የብሔራዊ መታወቂያዎ ፎቶ።',
          'በመታወቂያው ላይ እንደተጻፈው ሙሉ ስምዎና የመታወቂያ ቁጥርዎ።',
          'ከመታወቂያዎ ጋር የተገናኘው ስልክ ቁጥርና የSMS ኮዱ በትክክል መግባቱ።',
        ],
      },
      {
        heading: 'መረጃው እንዴት ይጠበቃል',
        points: [
          'የመታወቂያዎ ፎቶና ቁጥር ከመቀመጣቸው በፊት በአስተማማኝ ሁኔታ ይመሰጠራሉ (AES-256)። የመታወቂያ ፎቶው ከገበያ መረጃ ተለይቶ በተመሰጠረ ፋይል ውስጥ ይቀመጣል።',
          'የመታወቂያ ቁጥርዎ ተመሳሳይ መታወቂያ በሁለት አካውንቶች ላይ እንዳይውል ብቻ ወደ አንድ አቅጣጫ ጣት አሻራ (fingerprint) ይቀየራል። ቁጥሩን ከዚያ ጣት አሻራ መልሶ ማንበብ አይቻልም።',
          'መረጃው በመሣሪያዎና በሰርቨሮቻችን መካከል በተመሰጠረ ግንኙነት (HTTPS) ይጓዛል።',
          'የመታወቂያ ፎቶን መክፈት የሚችሉት ፈቃድ ያላቸው የTruth Market ገምጋሚዎች ብቻ ናቸው፣ እየገመገሙ ሳለ ብቻ፣ እና ፎቶው በተከፈተ ቁጥር በመዝገብ ይጻፋል።',
          'የSMS ኮዶች የሚቀመጡት በhash መልክ ብቻ ነው፣ ከ5 ደቂቃ በኋላ ጊዜያቸው ያበቃል፣ ከ5 የተሳሳቱ ሙከራዎች በኋላም ይታገዳሉ።',
        ],
      },
      {
        heading: 'ማን ሊያየው ይችላል',
        body: 'የብሔራዊ መታወቂያዎና ፎቶው ለገዢዎችም ሆነ ለሌሎች ተጠቃሚዎች በጭራሽ አይታይም፤ ለሶስተኛ ወገን አይሸጥም ወይም አይጋራም። ገዢዎች የሚያዩት "የተረጋገጠ ሻጭ" ምልክትን ብቻ ነው። ሁለት ጠባብ ልዩነቶች አሉ፦ የSMS አቅራቢያችን ኮዱን ለማድረስ ስልክ ቁጥርዎንና የኮዱን መልእክት ይቀበላል፣ እንዲሁም የኢትዮጵያ ሕግ ሲያስገድድ መረጃን ለባለሥልጣናት እንገልጻለን።',
      },
      {
        heading: 'ለምን ያህል ጊዜ እንይዘዋለን',
        body: 'ማመልከቻን ከተውነው የመታወቂያ ፎቶውና ቁጥሩ ወዲያውኑ ይሰረዛል። ለተረጋገጡ ሻጮች የሻጩ አካውንት ንቁ እስከሆነ ድረስና ማጭበርበርን ለመመርመር ሕግ እስከሚፈቅደው ጊዜ ድረስ ይቆያል። አካውንትዎን ከዘጉ በኋላ የማንነት መረጃዎ እንዲሰረዝ መጠየቅ ይችላሉ።',
      },
    ],
    contactTitle: 'ጥያቄ ካለዎት',
    contact: 'በTelegram @wodlabs ወይም በWhatsApp +251 987 811 955 ያግኙን።',
    verifyCta: 'ማንነቴን አረጋግጥ',
    switchLabel: 'ቋንቋ',
  },
};

function Section({ block, level = 2 }: { block: Block; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section className="mt-6">
      <H className={level === 2 ? 'text-xl font-extrabold' : 'text-base font-bold'}>{block.heading}</H>
      {block.body && <p className="mt-2 leading-relaxed text-slate-700">{block.body}</p>}
      {block.points && (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-slate-700">
          {block.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PrivacyPolicy() {
  // Follows the language switch in the header (one choice for the whole site) and also has its own switch here.
  const { lang, setLang } = useI18n();
  const t = COPY[lang];

  // /privacy#identity-verification scrolls straight to the identity section.
  useEffect(() => {
    if (window.location.hash === '#identity-verification') document.getElementById('identity-verification')?.scrollIntoView();
  }, []);

  return (
    <main lang={lang} className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t.title}</h1>
        <div role="group" aria-label={t.switchLabel} className="inline-flex overflow-hidden rounded-full border-[1.5px] border-slate-900 text-sm font-bold">
          {(['am', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`px-4 py-1.5 transition-colors ${lang === l ? 'bg-blue-600 text-white' : 'hover:bg-slate-100'}`}
            >
              {l === 'am' ? 'አማ' : 'EN'}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t.updated}</p>
      <p className="mt-4 leading-relaxed text-slate-700">{t.intro}</p>

      {t.general.map((b) => (
        <Section key={b.heading} block={b} />
      ))}

      <section id="identity-verification" aria-labelledby="idv-h" className="mt-8 scroll-mt-24 rounded-2xl border-[1.5px] border-slate-900 bg-slate-50 p-5">
        <h2 id="idv-h" className="text-xl font-extrabold">
          {t.idTitle}
        </h2>
        <p className="mt-2 font-medium leading-relaxed">{t.idLead}</p>
        {t.id.map((b) => (
          <Section key={b.heading} block={b} level={3} />
        ))}
        <Link to="/verify" className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
          {t.verifyCta}
        </Link>
      </section>

      <Section block={{ heading: t.contactTitle, body: t.contact }} />
    </main>
  );
}
