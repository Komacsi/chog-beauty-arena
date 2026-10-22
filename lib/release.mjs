// A code-reviewed release decision, not an environment variable bypass.
// See SECURITY_REVIEW.md. This does not prevent third parties deploying source.
export const RELEASE_STATUS=Object.freeze({
  realFundsEnabled:true,
  arenaAddress:'0xBBEEe440795aCe96F7b6b0D14dc06A5e6A9005d5',
  deploymentBlock:115710675,
  blockingFindings:[],
  // Exact reviewed deployment only. See the owner decisions and launch evidence.
  acceptedRisks:['SEC-02','CHOG-SOURCE'],
  trustModel:'safe-governed-authorized-revealer',
  message:'Live operation is approved only for the reviewed Monad arena. Demo remains separate.'
});

export function assertLiveReleaseAllowed(arenaAddress){
  if(arenaAddress && (!RELEASE_STATUS.realFundsEnabled || arenaAddress.toLowerCase()!==RELEASE_STATUS.arenaAddress.toLowerCase()))throw Error(RELEASE_STATUS.message);
}
