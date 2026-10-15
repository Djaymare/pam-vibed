import { ref } from 'vue';

import type { CommandAction, Methods } from '../contracts.generated';
import { describeError } from '../errors';
import type { Profile } from './useProfile';
import type { Proposals } from './useProposals';
/** Text and explicit action requests share one typed submission path. */
export function useRequests(
  profile: Profile,
  proposals: Proposals,
  canRequest: () => boolean,
  isLocked: () => boolean,
) {
  const { request, busy, error, updateHealth } = profile;
  const text = ref('');
  async function process<M extends 'process_text' | 'process_audio' | 'prepare_action'>(
    method: M,
    payload: Methods[M]['payload'],
  ) {
    busy.value = true;
    error.value = '';
    try {
      const turn = await request(method, payload);
      proposals.add(turn);
      text.value = '';
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      busy.value = false;
      void updateHealth();
    }
  }
  async function submitText() {
    if (canRequest() && text.value.trim())
      await process('process_text', { text: text.value.trim() });
  }
  async function prepareMediaAction(
    applicationId: string,
    action: CommandAction,
    args: Record<string, string>,
    label: string,
  ) {
    if (!isLocked())
      await process('prepare_action', { applicationId, action, arguments: args, label });
  }

  return { text, process, submitText, prepareMediaAction };
}
export type Requests = ReturnType<typeof useRequests>;
