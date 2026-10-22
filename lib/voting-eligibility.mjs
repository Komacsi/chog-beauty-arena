// Roles are fixed when the request is accepted, independently of later NFT transfers.
// Older rounds retain the rules under which their entries were accepted.
export function isRoundParticipant(round,account){
  return round?.protocolVersion>=8 && Boolean(account) && [round.participantA,round.participantB].some(p=>p?.toLowerCase()===account.toLowerCase());
}
