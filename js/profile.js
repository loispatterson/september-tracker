/* Client-side mirror of api/_lib/profile.js — the labels the UI shows and the
   age-band widening the rules engine needs. Kept pure so it can be tested. */

export const AGE_BANDS = [
  ["under25", "Under 25"], ["25-29", "25–29"], ["30-34", "30–34"], ["35-39", "35–39"],
  ["40-44", "40–44"], ["45-49", "45–49"], ["50-54", "50–54"], ["55-59", "55–59"],
  ["60-64", "60–64"], ["65plus", "65+"],
];

export const GOALS = [
  ["weightloss", "Lose weight"], ["strength", "Get stronger"], ["cardio", "Fitter / cardio"],
  ["mobility", "Mobility"], ["general", "General fitness"],
];

export const FITNESS = [
  ["starting", "Starting out"], ["occasional", "Occasional"],
  ["regular", "Regular"], ["veryactive", "Very active"],
];

/* Widen a legacy band to the five-year bands it covers, so accounts created
   before the finer bands still get age-appropriate suggestions. */
export function expandAgeBand(band) {
  switch (band) {
    case "under30": return ["under25", "25-29"];
    case "30-44": return ["30-34", "35-39", "40-44"];
    case "45-59": return ["45-49", "50-54", "55-59"];
    case "60plus": return ["60-64", "65plus"];
    default: return AGE_BANDS.some(([v]) => v === band) ? [band] : [];
  }
}

export const isLegacyBand = (b) => ["under30", "30-44", "45-59", "60plus"].includes(b);
