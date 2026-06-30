import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox, Stack } from '../components/ds';

// ── Checkbox ─────────────────────────────────────────────────────────────
const checkboxMeta: Meta<typeof Checkbox> = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { label: 'I agree to the vault terms', checked: false },
};
export default checkboxMeta;
type CheckboxStory = StoryObj<typeof Checkbox>;

export const Unchecked:     CheckboxStory = { args: { checked: false } };
export const Checked:       CheckboxStory = { args: { checked: true } };
export const Indeterminate: CheckboxStory = { args: { indeterminate: true, label: 'Select all positions' } };
export const WithDesc:      CheckboxStory = { args: { checked: true, description: 'Enable automatic yield compounding every 24h' } };
export const WithError:     CheckboxStory = { args: { error: 'You must accept terms to continue' } };
export const DisabledCheck: CheckboxStory = { args: { disabled: true, checked: true } };

export const InStack = {
  name: 'In Stack',
  render: () => (
    <Stack gap={3}>
      <Checkbox label="Auto-harvest" checked />
      <Checkbox label="Share analytics" />
    </Stack>
  ),
};
