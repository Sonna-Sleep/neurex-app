// In-app legal/info content, rendered natively by LegalScreen (NOT opened in a
// browser). Plain data so it's dependency-free and unit-testable in Node.
//
// This module is the source for what users read inside the app. Keep the hosted
// policy and App Store listing aligned with this copy.

export type LegalDocKey = 'privacy' | 'about';

export type LegalSection = {
  heading?: string;
  /** Paragraphs separated by a blank line ("\n\n"); single "\n" is a line break. */
  body: string;
};

export type LegalDoc = {
  title: string;
  updated?: string;
  intro?: string;
  sections: LegalSection[];
};

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  privacy: {
    title: 'Privacy Policy',
    updated: 'Last updated 2026-06-09',
    intro:
      'Neurex ("we", "us") makes a sleep-tracking sleep mask and companion app. ' +
      'This policy explains what we collect, why, and your rights. ' +
      'Contact: contact@neurex.tech.\n\n' +
      'Neurex is a wellness product. It is not a medical device and does not ' +
      'diagnose, treat, or prevent any disease.',
    sections: [
      {
        heading: 'what we collect',
        body:
          'Account: your email address (for sign-in via magic link).\n' +
          'Sleep recordings: EEG signals recorded by the sleep mask, and the ' +
          'sleep metrics derived from them (stages, sleep score, time-in-bed, etc.).\n' +
          'Device & diagnostic: minimal app/device information needed to operate and ' +
          'troubleshoot the service.\n\n' +
          'We do not use your data for advertising, and we do not track you across ' +
          'other apps or websites.',
      },
      {
        heading: 'how we use it',
        body:
          'To provide the service: store your recordings, run sleep staging, and show ' +
          'you your results. To maintain and improve reliability and security.',
      },
      {
        heading: "where it's stored",
        body:
          'Recordings and account data are stored with Supabase (database + file ' +
          'storage) in the United States (us-east-1) and processed by Modal for sleep ' +
          'staging. Data is encrypted in transit (HTTPS/TLS). If you are in the ' +
          'EU/EEA, note that your data is processed in the United States.',
      },
      {
        heading: 'retention & deletion',
        body:
          'You can delete your account and all associated data at any time from the ' +
          'app (Account → delete account). You may delete immediately, or schedule ' +
          'deletion in 30 days (cancellable by logging back in before then). When ' +
          'deletion completes, your recordings, derived metrics, and account are ' +
          'permanently removed.',
      },
      {
        heading: 'your rights',
        body:
          'Depending on your region (e.g. GDPR/CCPA), you may have rights to access, ' +
          'correct, export, or delete your data. Email contact@neurex.tech to ' +
          'exercise them.',
      },
      {
        heading: 'children',
        body:
          'Neurex is not directed to children under 13 and we do not knowingly ' +
          'collect their data.',
      },
      {
        heading: 'changes',
        body:
          'We may update this policy; material changes will be reflected by the ' +
          '"Last updated" date above.',
      },
    ],
  },
  about: {
    title: 'About Neurex',
    intro:
      "Neurex turns a night's sleep into something you can see. A comfortable " +
      'dry-electrode EEG sleep mask reads your brain activity directly — no gels, no ' +
      'wires to a wall — and the app shows you a clear picture of your night the ' +
      'morning after.',
    sections: [
      {
        heading: 'what you get',
        body:
          'A full-night hypnogram (wake, light, deep, REM), time asleep, sleep ' +
          'efficiency, and a single nightly sleep score to track trends over time.',
      },
      {
        heading: 'how it works',
        body:
          'Wear the sleep mask to bed. It streams your EEG to your phone overnight; in ' +
          'the morning your recording is analyzed automatically and your results sync ' +
          'to your account.',
      },
      {
        heading: 'wellness, not medical',
        body:
          'Neurex is a wellness product to help you understand your sleep. It is not ' +
          'a medical device and does not diagnose, treat, or prevent any condition.',
      },
      {
        heading: 'contact',
        body:
          'Questions or feedback? Email contact@neurex.tech. Learn more at neurex.tech.',
      },
    ],
  },
};
