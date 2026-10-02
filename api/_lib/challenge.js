/* Server-side view of the challenge config.

   The definitions live in js/challenge.js so there is exactly one copy and the
   client and the API can never disagree about what challenge this deployment
   is running. This file re-exports them and adds the one thing only the server
   knows: which challenge the environment selects.

   Importing across the tree like this is the existing house pattern —
   js/selftests.js already imports ../api/_lib/activity.js so the same rules
   are tested once. */
export { CHALLENGES, DEFAULT_CHALLENGE, challengeConfig, shouldShowPromo }
  from "../../js/challenge.js";

import { challengeConfig } from "../../js/challenge.js";

/* The challenge this deployment runs. No CHALLENGE set means the wellbeing
   board, so the friends' deployment needs no env var at all. */
export function challengeFromEnv(env = process.env) {
  return challengeConfig(env.CHALLENGE);
}
