import type { Tab } from '../state';
import { copyToClipboard, useFeedback } from '../utils';

interface Props {
  tab: Tab;
  /** Active-tab text derived in App.tsx. Kept flat (single string) so this
   *  component never holds references to data that might grow stale. */
  text: string;
}

type Feedback = 'copied' | 'failed';

export function CopyButton({ tab, text }: Props) {
  const [feedback, flash] = useFeedback<Feedback>();

  const baseLabel = tab === 'json' ? 'Copy JSON' : 'Copy Prompt';
  const label = feedback === 'copied' ? 'Copied!' : feedback === 'failed' ? 'Copy failed' : baseLabel;
  const cls = `btn-candy${feedback === 'copied' ? ' copied' : feedback === 'failed' ? ' copy-failed' : ''}`;

  async function handleClick() {
    if (!text) return;
    flash((await copyToClipboard(text)) ? 'copied' : 'failed');
  }

  return (
    <button class={cls} disabled={!text} onClick={handleClick}>
      {label}
    </button>
  );
}
