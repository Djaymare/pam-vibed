import { computed, ref } from 'vue';
import type { CommandAction, Methods } from '../contracts.generated';
import { describeError } from '../errors';
import type { OperationToken } from './useAsyncScope';
import type { Profile } from './useProfile';
import type { Proposals } from './useProposals';

export function useRequests(
  profile: Profile,
  proposals: Proposals,
  canRequest: () => boolean,
  isLocked: () => boolean,
) {
  const { request, error, updateHealth, beginMutation, mutation } = profile;
  const text = ref('');
  const sent = ref(false);
  const processing = computed(
    () =>
      mutation.pending.value &&
      ['process_text', 'process_audio', 'prepare_action'].includes(mutation.kind.value),
  );
  const voiceProcessing = computed(
    () => processing.value && mutation.kind.value === 'process_audio',
  );
  async function process<M extends 'process_text' | 'process_audio' | 'prepare_action'>(
    method: M,
    payload: Methods[M]['payload'],
    reservation?: OperationToken,
  ) {
    const token = reservation ?? beginMutation(method);
    if (!token || !token.current()) return;
    error.value = '';
    sent.value = true;
    try {
      const turn = await request(method, payload);
      if (!token.current()) return;
      proposals.add(turn);
      text.value = '';
    } catch (caught) {
      if (token.current()) {
        token.fail();
        error.value = describeError(caught);
      }
    } finally {
      sent.value = false;
      token.finish();
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
    if (!isLocked() && canRequest())
      await process('prepare_action', { applicationId, action, arguments: args, label });
  }
  return { text, process, submitText, prepareMediaAction, processing, voiceProcessing, sent };
}
export type Requests = ReturnType<typeof useRequests>;
