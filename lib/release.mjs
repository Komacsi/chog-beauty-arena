// A code-reviewed release decision, not an environment variable bypass.
// See SECURITY_REVIEW.md. This does not prevent third parties deploying source.
export const RELEASE_STATUS=Object.freeze({
  realFundsEnabled:false,
  blockingFindings:['SEC-03','SEC-04'],
  acceptedRisks:['SEC-02'], // Multi-wallet voting explicitly accepted by the game creator.
  trustModel:'immutable-authorized-revealer',
  message:'Real-token deployment is disabled pending security fixes. Demo remains available.'
});

export function assertLiveReleaseAllowed(arenaAddress){
  if(arenaAddress && !RELEASE_STATUS.realFundsEnabled)throw Error(RELEASE_STATUS.message);
}
