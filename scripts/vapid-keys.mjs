/* Generate the VAPID key pair: node scripts/vapid-keys.mjs

   Run once, ever. VAPID is how a push service knows a message really came from
   this app, so the pair identifies the deployment rather than any person.

   Changing the keys later invalidates every subscription already issued —
   every phone would silently stop receiving, with nothing in any log to say
   why, and each person would have to turn reminders on again. So: generate
   once, store, and leave alone.

   The public key goes in VAPID_PUBLIC_KEY on Vercel (the client needs it to
   subscribe, and it is served to every browser, so it is not a secret). The
   private key goes in GitHub Actions secrets ONLY, never on Vercel — nothing
   in api/ sends anything, and a secret that is not deployed cannot leak from
   a deployment. */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Generated once. Store both now — they cannot be recovered.

  Vercel (cairn project) → Settings → Environment Variables, Production:

    VAPID_PUBLIC_KEY   ${publicKey}

  GitHub → repo → Settings → Secrets and variables → Actions:

    VAPID_PUBLIC_KEY   ${publicKey}
    VAPID_PRIVATE_KEY  ${privateKey}
    VAPID_SUBJECT      mailto:your@email
    DATABASE_URL       the cairn Neon connection string

The private key must NOT go on Vercel. Nothing in api/ sends a notification —
the sender runs in GitHub Actions — so there is no reason for the deployment
to be able to.
`);
