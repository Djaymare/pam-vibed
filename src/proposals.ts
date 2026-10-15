import type { ProposalSnapshot, Turn } from './types';

export function retainTurns(turns: Turn[]): Turn[] {
  let resolved = 0;
  return turns.filter(turn => turn.status === 'pending' || ++resolved <= 20);
}
export function reconcileTurns(turns: Turn[], snapshots: ProposalSnapshot[] = [], now = Date.now()): Turn[] {
  return turns.map(turn => {
    if (turn.status !== 'pending') return turn;
    const next = snapshots.find(item => item.id === turn.id) || turn.proposal;
    if (!next) return turn;
    const proposal = next.state === 'pending' && next.expiresAt !== null && now >= next.expiresAt
      ? { ...next, state: 'expired' as const, reason: 'expired', message: 'Cette proposition a expiré après dix minutes. Reformulez votre demande.' } : next;
    if (proposal.state === 'pending') return { ...turn, proposal };
    return { ...turn, proposal, status: proposal.state === 'unknown' ? 'invalidated' : proposal.state,
      message: 'message' in proposal ? proposal.message : turn.message };
  });
}
