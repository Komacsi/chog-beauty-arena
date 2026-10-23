// A code-reviewed release decision, not an environment variable bypass.
// See SECURITY_REVIEW.md. This does not prevent third parties deploying source.
export const RELEASE_STATUS=Object.freeze({
  realFundsEnabled:true,
  arenaAddress:'0x8Cd36066717FF98D86FebC3294A98aC2f0095d05',
  deploymentBlock:115749283,
  runtimeCodeHash:'0x25c32735d5c351ae648b040c6f68aecea3dc90de4033e0731c779e0e0eceeca6',
  artifact:'BeautyArenaV2.json',
  rulesVersion:8,
  blockingFindings:[],
  // Exact reviewed deployment only. See the owner decisions and launch evidence.
  acceptedRisks:['SEC-02','CHOG-SOURCE'],
  trustModel:'safe-governed-authorized-revealer',
  message:'Live operation is approved only for the reviewed Monad arena. Demo remains separate.'
});

export function assertLiveReleaseAllowed(arenaAddress){
  if(arenaAddress && (!RELEASE_STATUS.realFundsEnabled || arenaAddress.toLowerCase()!==RELEASE_STATUS.arenaAddress.toLowerCase()))throw Error(RELEASE_STATUS.message);
}
